import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, numberToHex, recoverTypedDataAddress, zeroAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { registryAbi } from "@/lib/chain/abi";
import { doorPassTypes, registryDomain } from "@/lib/chain/eip712";
import { decodeDoorPass } from "@/lib/qr/payload";
import { setChainContext } from "@/server/chain";
import { resetRateLimiters } from "@/server/kv";
import { fakeChainClient } from "@/server/testing/fake-chain";
import { judgesDeskConfig } from "./issue";
import { GET } from "./route";

const REGISTRY: Address = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const DOOR_KEY = generatePrivateKey();
const door = privateKeyToAccount(DOOR_KEY);
const NOW = 1_796_000_000n;

interface Chain {
  organizer: Address;
  validUntil: bigint;
  startsAt: bigint;
  endsAt: bigint;
}

function install(chain: Chain) {
  const client = fakeChainClient(
    {
      [REGISTRY]: {
        abi: registryAbi,
        handler: (fn, args) => {
          if (fn === "eventInfo") {
            return { organizer: chain.organizer, startsAt: chain.startsAt, endsAt: chain.endsAt, capacity: 0, checkedIn: 3, maxPassAge: 120, seriesId: 0n, seriesIndex: 0 };
          }
          if (fn === "doorKeyValidUntil") return getAddress(args[1] as Address) === door.address ? chain.validUntil : 0n;
          throw new Error(`unexpected ${fn}`);
        },
      },
    },
    {
      eth_getBlockByNumber: () => ({
        number: numberToHex(9_000_000),
        hash: `0x${"b1".repeat(32)}`,
        parentHash: `0x${"b0".repeat(32)}`,
        timestamp: numberToHex(NOW),
        gasLimit: "0xffffffff",
        gasUsed: "0x0",
        baseFeePerGas: "0x7",
        miner: zeroAddress,
        extraData: "0x",
        logsBloom: `0x${"00".repeat(256)}`,
        transactions: [],
        uncles: [],
      }),
    },
  );
  setChainContext({ chainId: 1983, client, registry: REGISTRY, vault: zeroAddress, bond: zeroAddress, qusdc: zeroAddress, oracle: zeroAddress, nameRegistry: zeroAddress, paidNameRegistry: zeroAddress, deployBlock: 0n });
}

const openEvent: Chain = { organizer: getAddress("0x91c4e2b7a3d5f8e1c6a9b0d4e7f2a5c8b1d3e6f9"), validUntil: NOW + 86_400n, startsAt: NOW - 3_600n, endsAt: NOW + 86_400n };

function request(ip = "203.0.113.7") {
  return new Request("https://showmark.app/api/judges-desk/pass", { headers: { "x-real-ip": ip } });
}

beforeEach(() => {
  resetRateLimiters();
  vi.stubEnv("JUDGES_DOOR_KEY", DOOR_KEY);
  vi.stubEnv("NEXT_PUBLIC_JUDGES_DESK_EVENT_ID", "7");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setChainContext(null);
});

describe("GET /api/judges-desk/pass", () => {
  it("signs a fresh door pass that recovers to the judges' door key with the ticket address", async () => {
    install(openEvent);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { url: string; issuedAt: string; expiresAt: string };
    expect(body.issuedAt).toBe(new Date(Number(NOW) * 1000).toISOString());
    expect(body.expiresAt).toBe(new Date(Number(NOW + 120n) * 1000).toISOString());
    expect(body.url.startsWith("https://showmark.app/c/7.")).toBe(true);

    const pass = decodeDoorPass(body.url);
    expect(pass).not.toBeNull();
    if (!pass) return;
    expect(pass.issuedAt).toBe(NOW);
    const signer = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: doorPassTypes,
      primaryType: "DoorPass",
      message: { eventId: 7n, issuedAt: NOW, ticket: privateKeyToAccount(pass.ticketKey).address },
      signature: pass.doorSig,
    });
    expect(signer).toBe(door.address);
    // The door key itself never leaves the server.
    expect(JSON.stringify(body)).not.toContain(DOOR_KEY.slice(2));
  });

  it("uses a new ticket key on every request", async () => {
    install(openEvent);
    const a = decodeDoorPass(((await (await GET(request())).json()) as { url: string }).url);
    const b = decodeDoorPass(((await (await GET(request())).json()) as { url: string }).url);
    expect(a?.ticketKey).toBeDefined();
    expect(a?.ticketKey).not.toBe(b?.ticketKey);
  });

  it("says the desk is not open when the env is missing", async () => {
    vi.stubEnv("JUDGES_DOOR_KEY", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "judges_desk_not_open", message: "The judges' desk is not open yet.", action: expect.any(String) },
    });
  });

  it("says the desk is being set up when the door key is not authorized", async () => {
    install({ ...openEvent, validUntil: 0n });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("judges_desk_door_not_ready");
  });

  it("refuses outside the check-in window and when the event does not exist", async () => {
    install({ ...openEvent, startsAt: NOW + 7_200n, endsAt: NOW + 9_000n });
    expect((await GET(request())).status).toBe(409);
    install({ ...openEvent, organizer: zeroAddress });
    expect(((await (await GET(request())).json()) as { error: { code: string } }).error.code).toBe("judges_desk_not_open");
  });

  it("rate limits each address", async () => {
    install(openEvent);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await GET(request("198.51.100.4"))).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("rejects a malformed key without printing it", () => {
    expect(() => judgesDeskConfig({ JUDGES_DOOR_KEY: "0x1234secret", NEXT_PUBLIC_JUDGES_DESK_EVENT_ID: "7" })).toThrow(/JUDGES_DOOR_KEY/);
    expect(() => judgesDeskConfig({ JUDGES_DOOR_KEY: "0x1234secret", NEXT_PUBLIC_JUDGES_DESK_EVENT_ID: "7" })).not.toThrow(/secret/);
  });
});
