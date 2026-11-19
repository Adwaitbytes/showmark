import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleMcpRequest, httpDataSource, optionsFromEnv, ShowmarkConfigProblem, ShowmarkDataError } from "../src/index";
import { startHttpServer } from "../src/node-http";
import { campaign, eventDetail, fakeData, summary, traction } from "./fixtures";

const rpc = (body: unknown): Request =>
  new Request("https://showmark.example/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });

describe("handleMcpRequest (stateless Streamable HTTP)", () => {
  it("answers initialize and tools/call with plain JSON, one fresh server per request", async () => {
    const init = await handleMcpRequest(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      { data: fakeData() },
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toContain("application/json");
    expect(init.headers.get("mcp-session-id")).toBeNull();
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("showmark");

    const res = await handleMcpRequest(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "showmark_traction", arguments: {} } }), {
      data: fakeData(),
    });
    const body = (await res.json()) as { result: { structuredContent: { verifiedAttendees: number } } };
    expect(body.result.structuredContent.verifiedAttendees).toBe(37);
  });

  it("refuses GET and DELETE with 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await handleMcpRequest(new Request("https://showmark.example/api/mcp", { method }), {});
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("standalone HTTP server", () => {
  let url: URL;
  let close: () => void;

  beforeAll(async () => {
    const server = await startHttpServer({ options: { data: fakeData() }, port: 0, host: "127.0.0.1" });
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    close = () => server.close();
  });
  afterAll(() => close());

  it("works with the official Streamable HTTP client", async () => {
    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(url));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const result = await client.callTool({ name: "showmark_get_campaign", arguments: { campaignId: "7" } });
    const structured = "structuredContent" in result ? (result.structuredContent as { campaign: { settledCount: number } }) : null;
    expect(structured?.campaign.settledCount).toBe(3);
    await client.close();
  });

  it("rejects foreign Host headers on loopback and unknown paths", async () => {
    // fetch forbids setting Host, so send this one with node:http the way a rebinding page would arrive.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { method: "POST", headers: { host: "evil.example", "content-type": "application/json" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(status).toBe(403);
    const other = await fetch(new URL("/other", url));
    expect(other.status).toBe(404);
  });
});

describe("httpDataSource", () => {
  const fetchFrom = (routes: Record<string, () => Response>) =>
    vi.fn(async (input: string, _init?: RequestInit) => {
      const u = new URL(input);
      const handler = routes[`${u.pathname}${u.search}`];
      if (!handler) return Response.json({ error: { code: "not_found", message: "Not found.", action: "Check the id." } }, { status: 404 });
      return handler();
    });

  it("reads and validates every route", async () => {
    const fetch = fetchFrom({
      "/api/traction": () => Response.json(traction),
      "/api/events?organizer=0x4444444444444444444444444444444444444444&upcoming=1&limit=5": () => Response.json({ events: [summary] }),
      "/api/events/42": () => Response.json(eventDetail),
      "/api/campaigns/7": () => Response.json(campaign),
    });
    const data = httpDataSource({ apiUrl: "https://showmark.example/", fetch });
    expect(await data.getTraction()).toEqual(traction);
    expect(await data.listEvents({ organizer: "0x4444444444444444444444444444444444444444", upcoming: true, limit: 5 })).toEqual([summary]);
    expect(await data.getEvent("42")).toEqual(eventDetail);
    expect(await data.getCampaign("7")).toEqual(campaign);
    expect(await data.getEvent("404")).toBeNull();
    expect(await data.getPassport("nobody.qie")).toBeNull();
  });

  it("surfaces API copy, rejects unexpected shapes and reports unreachable hosts", async () => {
    const failing = httpDataSource({
      apiUrl: "https://showmark.example",
      fetch: fetchFrom({
        "/api/traction": () => Response.json({ error: { code: "database_not_configured", message: "Showmark cannot reach its database right now.", action: "Try again in a few minutes." } }, { status: 503 }),
        "/api/campaigns/7": () => Response.json({ ...campaign, balance: -1 }),
      }),
    });
    await expect(failing.getTraction()).rejects.toMatchObject({ code: "database_not_configured", action: "Try again in a few minutes." });
    await expect(failing.getCampaign("7")).rejects.toMatchObject({ code: "unexpected_shape" });

    const offline = httpDataSource({
      apiUrl: "https://showmark.example",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.getTraction()).rejects.toBeInstanceOf(ShowmarkDataError);
    expect(() => httpDataSource({ apiUrl: "ftp://x" })).toThrow(ShowmarkDataError);
  });
});

describe("optionsFromEnv", () => {
  it("defaults to mainnet and validates addresses and chain ids", () => {
    const options = optionsFromEnv({ SHOWMARK_API_URL: "https://showmark.example", SHOWMARK_REGISTRY_ADDRESS: "0x1111111111111111111111111111111111111111" });
    expect(options.chain?.id).toBe(1990);
    expect(options.client?.addresses.registry).toBe("0x1111111111111111111111111111111111111111");
    expect(options.data).toBeDefined();
    expect(optionsFromEnv({}).data).toBeUndefined();
    expect(() => optionsFromEnv({ SHOWMARK_CHAIN_ID: "1" })).toThrow(ShowmarkConfigProblem);
    expect(() => optionsFromEnv({ SHOWMARK_REGISTRY_ADDRESS: "0xabc" })).toThrow(ShowmarkConfigProblem);
    expect(() => optionsFromEnv({ SHOWMARK_RPC_URL: "wss://x" })).toThrow(ShowmarkConfigProblem);
  });
});
