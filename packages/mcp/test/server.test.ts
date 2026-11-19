import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ShowmarkClient, qieTestnet, registryAbi, vaultAbi } from "@showmark/sdk";
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createShowmarkMcpServer, ShowmarkDataError, type ShowmarkMcpOptions } from "../src/index";
import { alice, fakeData, organizer, tx } from "./fixtures";

const registry: Address = "0x1111111111111111111111111111111111111111";
const vault: Address = "0x2222222222222222222222222222222222222222";

function chainClient(): ShowmarkClient {
  const publicClient = createPublicClient({
    chain: qieTestnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_chainId") return "0x7bf";
        const [call] = params as [{ to: Address; data: Hex }];
        const abi = call.to === vault ? vaultAbi : registryAbi;
        const { functionName, args } = decodeFunctionData({ abi, data: call.data });
        if (functionName === "hasAttended") return encodeFunctionResult({ abi: registryAbi, functionName, result: args?.[1] === alice });
        if (functionName === "presenceOf") {
          return encodeFunctionResult({ abi: registryAbi, functionName, result: args?.[1] === alice ? { mode: 2, at: 1795000000n } : { mode: 0, at: 0n } });
        }
        if (functionName === "eventInfo") {
          return encodeFunctionResult({
            abi: registryAbi,
            functionName,
            result: { organizer, startsAt: 1n, endsAt: 2n, capacity: 120, checkedIn: 37, maxPassAge: 60, seriesId: 0n, seriesIndex: 0 },
          });
        }
        if (functionName === "quote") return encodeFunctionResult({ abi: vaultAbi, functionName, result: [2_000_000n, true] });
        throw new Error(`unexpected ${functionName}`);
      },
    }),
  });
  return new ShowmarkClient({ chain: qieTestnet, publicClient, addresses: { registry, vault } });
}

async function connect(options: ShowmarkMcpOptions): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createShowmarkMcpServer(options).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text?: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

describe("Showmark MCP tools", () => {
  it("lists the seven read-only tools with schemas", async () => {
    const client = await connect({ data: fakeData(), client: chainClient() });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "showmark_get_campaign",
      "showmark_get_event",
      "showmark_get_passport",
      "showmark_has_attended",
      "showmark_list_events",
      "showmark_traction",
      "showmark_verified_reach",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
    }
    const info = client.getServerVersion();
    expect(info?.name).toBe("showmark");
    expect(client.getInstructions()).toContain("read-only");
  });

  it("returns traction and events", async () => {
    const client = await connect({ data: fakeData() });
    const t = await call(client, "showmark_traction");
    expect(t.isError).toBeFalsy();
    expect(t.structuredContent).toMatchObject({ verifiedAttendees: 37, sponsors: { teamFunded: 1, external: 1 } });
    expect(JSON.parse(t.content[0]?.text ?? "{}")).toEqual(t.structuredContent);

    const list = await call(client, "showmark_list_events", { upcoming: true, limit: 5 });
    expect(list.structuredContent).toMatchObject({ count: 1, events: [{ id: "42", name: "QIE builders night", city: "Bengaluru" }] });
  });

  it("cross-checks an event against the registry", async () => {
    const client = await connect({ data: fakeData(), client: chainClient() });
    const e = await call(client, "showmark_get_event", { eventId: "42" });
    expect(e.structuredContent).toMatchObject({
      event: { id: "42", checkedIn: 37, recentCheckIns: [{ txUrl: `https://testnet.qie.digital/tx/${tx(2)}` }] },
      onChain: { checkedIn: 37, organizer, matchesIndex: true },
    });
  });

  it("reports verified reach with totals and explorer links", async () => {
    const client = await connect({ data: fakeData(), client: chainClient() });
    const r = await call(client, "showmark_verified_reach", { campaignId: "7", limit: 2 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      campaignId: "7",
      settledCount: 3,
      distinctAttendees: 3,
      distinctEvents: 1,
      totals: { gross: "6000000", toAttendee: "2940000", toOrganizer: "2940000", fee: "120000" },
      truncated: true,
    });
    const settlements = r.structuredContent?.settlements as { at: string; explorerUrl: string }[];
    expect(settlements).toHaveLength(2);
    expect(settlements[0]?.at).toBe("2026-11-26T12:43:00.000Z");
    expect(settlements[0]?.explorerUrl).toBe(`https://testnet.qie.digital/tx/${tx(13)}`);
  });

  it("returns a campaign with the vault quote and a passport with stamps", async () => {
    const client = await connect({ data: fakeData(), client: chainClient() });
    const c = await call(client, "showmark_get_campaign", { campaignId: "7" });
    expect(c.structuredContent).toMatchObject({ campaign: { pricing: "token", events: [{ id: "42", approved: true }] }, quote: { amount: "2000000", priceFresh: true } });
    const p = await call(client, "showmark_get_passport", { addressOrName: "alice.qie" });
    expect(p.structuredContent).toMatchObject({ qieName: "alice.qie", stampCount: 1, stamps: [{ eventId: "42" }] });
  });

  it("answers has_attended from the chain", async () => {
    const client = await connect({ client: chainClient() });
    const yes = await call(client, "showmark_has_attended", { eventId: "42", account: alice });
    expect(yes.structuredContent).toEqual({
      eventId: "42",
      account: alice,
      attended: true,
      presence: { mode: 2, recordedAt: new Date(1795000000 * 1000).toISOString() },
      chainId: 1983,
      registry,
    });
    const no = await call(client, "showmark_has_attended", { eventId: "42", account: organizer });
    expect(no.structuredContent).toMatchObject({ attended: false, presence: null });
  });

  it("explains missing data, unknown ids, bad input and missing config as tool errors", async () => {
    const client = await connect({ data: fakeData() });
    const missing = await call(client, "showmark_get_event", { eventId: "9" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toBe("No Showmark event has id 9. Use showmark_list_events to find event ids.");

    const noChain = await call(client, "showmark_has_attended", { eventId: "42", account: alice });
    expect(noChain.isError).toBe(true);
    expect(noChain.content[0]?.text).toContain("SHOWMARK_REGISTRY_ADDRESS");

    const bad = await call(client, "showmark_get_event", { eventId: "forty-two" });
    expect(bad.isError).toBe(true);

    const noApi = await connect({});
    const t = await call(noApi, "showmark_traction");
    expect(t.isError).toBe(true);
    expect(t.content[0]?.text).toContain("SHOWMARK_API_URL");
  });

  it("passes data source copy through and hides unexpected internals", async () => {
    const failing = fakeData();
    failing.getTraction = async () => {
      throw new ShowmarkDataError({ code: "database_not_configured", message: "Showmark cannot reach its database right now.", action: "Try again in a few minutes." });
    };
    failing.getEvent = async () => {
      throw new Error("ECONNRESET at pg.connect secret-host:5432");
    };
    const client = await connect({ data: failing });
    expect((await call(client, "showmark_traction")).content[0]?.text).toBe("Showmark cannot reach its database right now. Try again in a few minutes.");
    const hidden = await call(client, "showmark_get_event", { eventId: "42" });
    expect(hidden.isError).toBe(true);
    expect(hidden.content[0]?.text).not.toContain("secret-host");
  });
});
