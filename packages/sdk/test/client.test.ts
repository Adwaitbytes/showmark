import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  parseAbi,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  ShowmarkClient,
  ShowmarkConfigError,
  ShowmarkContractError,
  ShowmarkNetworkError,
  checkInTypedData,
  createDoorPass,
  doorPassUrl,
  presenceAbi,
  qieTestnet,
  registryAbi,
  vaultAbi,
} from "@showmark/sdk";

const registry: Address = "0x1111111111111111111111111111111111111111";
const vault: Address = "0x2222222222222222222222222222222222222222";
const lens: Address = "0x3333333333333333333333333333333333333333";
const organizer: Address = "0x4444444444444444444444444444444444444444";
const alice: Address = "0x5555555555555555555555555555555555555555";
const qusdc: Address = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

const errorsAbi = parseAbi(["error UnknownEvent()"]);

interface Call {
  to: Address;
  functionName: string;
  args: readonly unknown[];
}

/** A public client whose eth_call is answered by `answer`, decoded with the real ABIs. */
function mockedClient(answer: (call: Call) => Hex) {
  const calls: Call[] = [];
  const publicClient = createPublicClient({
    chain: qieTestnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_chainId") return "0x7bf";
        if (method !== "eth_call") throw new Error(`unexpected ${method}`);
        const [tx] = params as [{ to: Address; data: Hex }];
        const abi = tx.to === vault ? vaultAbi : tx.to === lens ? presenceAbi : registryAbi;
        const decoded = decodeFunctionData({ abi, data: tx.data });
        const call = { to: tx.to, functionName: decoded.functionName, args: decoded.args ?? [] };
        calls.push(call);
        return answer(call);
      },
    }),
  });
  return { publicClient, calls };
}

describe("ShowmarkClient reads", () => {
  it("decodes eventInfo into a ShowmarkEvent", async () => {
    const { publicClient, calls } = mockedClient(() =>
      encodeFunctionResult({
        abi: registryAbi,
        functionName: "eventInfo",
        result: {
          organizer,
          startsAt: 1795070000n,
          endsAt: 1795080000n,
          capacity: 300,
          checkedIn: 41,
          maxPassAge: 60,
          seriesId: 3n,
          seriesIndex: 2,
        },
      }),
    );
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    expect(await client.getEvent(42n)).toEqual({
      id: 42n,
      organizer,
      startsAt: 1795070000n,
      endsAt: 1795080000n,
      capacity: 300,
      checkedIn: 41,
      maxPassAge: 60,
      seriesId: 3n,
      seriesIndex: 2,
    });
    expect(calls).toEqual([{ to: registry, functionName: "eventInfo", args: [42n] }]);
  });

  it("returns null for an event with no organizer", async () => {
    const { publicClient } = mockedClient(() =>
      encodeFunctionResult({
        abi: registryAbi,
        functionName: "eventInfo",
        result: { organizer: zeroAddress, startsAt: 0n, endsAt: 0n, capacity: 0, checkedIn: 0, maxPassAge: 0, seriesId: 0n, seriesIndex: 0 },
      }),
    );
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    expect(await client.getEvent(999n)).toBeNull();
  });

  it("decodes hasAttended, presenceOf and claimable", async () => {
    const { publicClient, calls } = mockedClient((call) => {
      if (call.functionName === "hasAttended") return encodeFunctionResult({ abi: registryAbi, functionName: "hasAttended", result: true });
      if (call.functionName === "presenceOf") {
        return encodeFunctionResult({ abi: registryAbi, functionName: "presenceOf", result: { mode: 2, at: 1795071234n } });
      }
      return encodeFunctionResult({ abi: vaultAbi, functionName: "claimable", result: 1_500_000n });
    });
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry, vault } });
    expect(await client.hasAttended(42n, alice)).toBe(true);
    expect(await client.presenceOf(42n, alice)).toEqual({ present: true, mode: 2, at: 1795071234n });
    expect(await client.claimable(qusdc, alice)).toBe(1_500_000n);
    expect(calls.map((c) => [c.to, c.functionName])).toEqual([
      [registry, "hasAttended"],
      [registry, "presenceOf"],
      [vault, "claimable"],
    ]);
  });

  it("reports an absent presence as mode 0", async () => {
    const { publicClient } = mockedClient(() =>
      encodeFunctionResult({ abi: registryAbi, functionName: "presenceOf", result: { mode: 0, at: 0n } }),
    );
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    expect(await client.presenceOf(1n, alice)).toEqual({ present: false, mode: 0, at: 0n });
  });

  it("asks PresenceLens for streaks when it is configured and the registry otherwise", async () => {
    const answer = (call: Call): Hex =>
      call.to === lens
        ? encodeFunctionResult({ abi: presenceAbi, functionName: "streakOf", result: [4, 6] })
        : encodeFunctionResult({ abi: registryAbi, functionName: "streakOf", result: [1, 2] });
    const withLens = mockedClient(answer);
    const withoutLens = mockedClient(answer);
    const a = new ShowmarkClient({ chain: 1983, publicClient: withLens.publicClient, addresses: { registry, lens } });
    const b = new ShowmarkClient({ chain: 1983, publicClient: withoutLens.publicClient, addresses: { registry } });
    expect(await a.streakOf(3n, alice)).toEqual({ current: 4, best: 6 });
    expect(await b.streakOf(3n, alice)).toEqual({ current: 1, best: 2 });
    expect(withLens.calls[0]?.to).toBe(lens);
    expect(withoutLens.calls[0]?.to).toBe(registry);
  });

  it("counts attended events through PresenceLens", async () => {
    const { publicClient, calls } = mockedClient(() =>
      encodeFunctionResult({ abi: presenceAbi, functionName: "attendedCount", result: 2n }),
    );
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { lens } });
    expect(await client.attendedCount(alice, [1n, 2n, 3n])).toBe(2);
    expect(calls[0]?.args).toEqual([alice, [1n, 2n, 3n]]);
  });

  it("decodes a campaign and its quote", async () => {
    const { publicClient } = mockedClient((call) =>
      call.functionName === "quote"
        ? encodeFunctionResult({ abi: vaultAbi, functionName: "quote", result: [2_000_000_000_000_000_000n, false] })
        : encodeFunctionResult({
            abi: vaultAbi,
            functionName: "campaign",
            result: {
              sponsor: alice,
              token: zeroAddress,
              pricing: 1,
              amountPerPresence: 500_000n,
              attendeeShareBps: 5000,
              feeBps: 200,
              minProofMode: 2,
              requireQieId: true,
              openToBonded: false,
              startsAt: 1795000000n,
              endsAt: 1796000000n,
              maxPerEvent: 100,
              maxTotal: 0,
              settledCount: 12,
              minBond: 0n,
              balance: 9_000_000_000_000_000_000n,
            },
          }),
    );
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { vault } });
    const campaign = await client.getCampaign(5n);
    expect(campaign).toMatchObject({ id: 5n, sponsor: alice, pricing: 1, minProofMode: 2, settledCount: 12, balance: 9_000_000_000_000_000_000n });
    expect(await client.quote(5n)).toEqual({ amount: 2_000_000_000_000_000_000n, priceFresh: false });
  });

  it("throws ShowmarkConfigError when an address is missing", async () => {
    const { publicClient } = mockedClient(() => "0x");
    const client = new ShowmarkClient({ chain: 1983, publicClient });
    await expect(client.hasAttended(1n, alice)).rejects.toBeInstanceOf(ShowmarkConfigError);
    await expect(client.quote(1n)).rejects.toBeInstanceOf(ShowmarkConfigError);
    await expect(client.attendedCount(alice, [])).rejects.toBeInstanceOf(ShowmarkConfigError);
    expect(() => new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry: "0xnope" } })).toThrow(ShowmarkConfigError);
    expect(() => new ShowmarkClient({ chain: 1 as 1983 })).toThrow(ShowmarkConfigError);
  });

  it("turns a revert into ShowmarkContractError", async () => {
    const { publicClient } = mockedClient(() => {
      throw Object.assign(new Error("execution reverted"), {
        code: 3,
        data: encodeErrorResult({ abi: errorsAbi, errorName: "UnknownEvent" }),
      });
    });
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    const error = await client.hasAttended(1n, alice).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowmarkContractError);
    expect((error as ShowmarkContractError).functionName).toBe("hasAttended");
  });

  it("turns empty return data into ShowmarkContractError that points at the address", async () => {
    const { publicClient } = mockedClient(() => "0x");
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    await expect(client.hasAttended(1n, alice)).rejects.toThrow(/contract address/);
  });

  it("turns a transport failure into ShowmarkNetworkError", async () => {
    const publicClient = createPublicClient({
      chain: qieTestnet,
      transport: custom({
        async request() {
          throw new Error("socket hang up");
        },
      }),
    });
    const client = new ShowmarkClient({ chain: 1983, publicClient, addresses: { registry } });
    await expect(client.hasAttended(1n, alice)).rejects.toBeInstanceOf(ShowmarkNetworkError);
  });
});

describe("ShowmarkClient relay calls", () => {
  const door = privateKeyToAccount(generatePrivateKey());
  const pass = privateKeyToAccount(generatePrivateKey());
  const txHash: Hex = `0x${"cd".repeat(32)}`;

  it("needs a relay URL", async () => {
    const client = new ShowmarkClient({ chain: 1983, addresses: { registry } });
    await expect(client.relayWithdraw({ token: zeroAddress, account: alice })).rejects.toBeInstanceOf(ShowmarkConfigError);
  });

  it("signs a scanned door pass with the pass key and relays it", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ txHash, status: "submitted" }));
    const client = new ShowmarkClient({ chain: 1983, addresses: { registry }, relayUrl: "https://showmark.example/", fetch: fetchMock });
    const doorPass = await createDoorPass({ chainId: 1983, registry, signer: door, eventId: 42n, issuedAt: 1795073006n });

    const result = await client.checkIn({ doorPass: doorPassUrl("https://showmark.example", doorPass), signer: pass });

    expect(result).toEqual({ txHash, status: "submitted" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://showmark.example/api/relay/check-in");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ eventId: "42", attendee: pass.address, mode: 1, doorTime: "1795073006", doorSig: doorPass.doorSig });
    const signer = await recoverTypedDataAddress({
      ...checkInTypedData({ chainId: 1983, registry }, { eventId: 42n, attendee: pass.address }),
      signature: body.attendeeSig as Hex,
    });
    expect(signer).toBe(pass.address);
  });

  it("links to the explorer on its chain", () => {
    const client = new ShowmarkClient({ chain: 1990 });
    expect(client.explorerTxUrl(txHash)).toBe(`https://mainnet.qie.digital/tx/${txHash}`);
  });
});
