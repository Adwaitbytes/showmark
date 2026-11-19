import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  parseTransaction,
  RpcRequestError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { bondAbi, registryAbi, vaultAbi } from "@/lib/chain/abi";
import { qieTestnet } from "@/lib/chain/chains";
import { checkInStatusCopy, settleStatusCopy } from "../errors";
import { MemoryStore } from "../kv";
import { tryLock } from "../lock";
import type { CheckInData } from "../schemas";
import { flushOnce, relayCheckIns, relayLockKey, type RelayerDeps } from "./queue";
import { RelayTargetError, sendSequential, type RelayerChain } from "./sender";
import { settleGasLimit } from "./settle";

// The first anvil key; used only against this in-memory fake chain.
const relayer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const registry: Address = "0x1000000000000000000000000000000000000001";
const vault: Address = "0x2000000000000000000000000000000000000002";
const bond: Address = "0x4000000000000000000000000000000000000004";

interface FakeState {
  chainNonce: number;
  /** Attendees (lowercase) that the registry would reject, with the status it would return. */
  reject: Map<string, number>;
  sent: Hex[];
  failNextSendWith: string | null;
  /** Chain nonce to report after the failed send, as if other transactions landed meanwhile. */
  nonceAfterFail: number | null;
}

function fakeChain(state: FakeState): RelayerChain {
  const client = createPublicClient({
    chain: qieTestnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        const p = (params ?? []) as unknown[];
        switch (method) {
          case "eth_chainId":
            return "0x7bf";
          case "eth_gasPrice":
            return "0x3b9aca00";
          case "eth_estimateGas":
            return "0x30d40";
          case "eth_getBalance":
            return "0x8ac7230489e80000";
          case "eth_getTransactionCount":
            return `0x${state.chainNonce.toString(16)}`;
          case "eth_call": {
            const call = p[0] as { to: Address; data: Hex };
            const { functionName, args } = decodeFunctionData({ abi: registryAbi, data: call.data });
            if (functionName !== "checkInBatch") throw new Error(`unexpected call ${functionName}`);
            const items = (args?.[0] ?? []) as readonly CheckInData[];
            const status = items.map((d) => state.reject.get(d.attendee.toLowerCase()) ?? 0);
            return encodeFunctionResult({ abi: registryAbi, functionName: "checkInBatch", result: status });
          }
          case "eth_sendRawTransaction": {
            if (state.failNextSendWith) {
              const message = state.failNextSendWith;
              state.failNextSendWith = null;
              if (state.nonceAfterFail !== null) state.chainNonce = state.nonceAfterFail;
              throw new RpcRequestError({ body: {}, url: "fake", error: { code: -32000, message } });
            }
            state.sent.push(p[0] as Hex);
            return "0x" + "00".repeat(32);
          }
          default:
            throw new Error(`fake chain: ${method}`);
        }
      },
    }),
  });
  return { chainId: qieTestnet.id, client, account: relayer, registry, vault, bond };
}

function checkIn(attendee: Address, eventId = 1n): CheckInData {
  return {
    eventId,
    attendee,
    mode: 1,
    doorTime: 1_795_000_000n,
    ticket: "0x3000000000000000000000000000000000000003",
    attendeeSig: `0x${"11".repeat(65)}`,
    doorSig: `0x${"22".repeat(65)}`,
    ticketSig: `0x${"33".repeat(65)}`,
  };
}

const attendees: Address[] = [
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
];

function decodeSent(raw: Hex) {
  const tx = parseTransaction(raw as `0x${string}`);
  if (!tx.data || !tx.to) throw new Error("sent transaction without data");
  if (tx.to.toLowerCase() === registry.toLowerCase()) return { tx, call: decodeFunctionData({ abi: registryAbi, data: tx.data }) };
  if (tx.to.toLowerCase() === bond.toLowerCase()) return { tx, call: decodeFunctionData({ abi: bondAbi, data: tx.data }) };
  return { tx, call: decodeFunctionData({ abi: vaultAbi, data: tx.data }) };
}

let state: FakeState;
let kv: MemoryStore;
let deps: RelayerDeps;

beforeEach(() => {
  state = { chainNonce: 7, reject: new Map(), sent: [], failNextSendWith: null, nonceAfterFail: null };
  kv = new MemoryStore();
  deps = {
    chain: fakeChain(state),
    kv,
    campaignsFor: async () => [3n, 4n],
    options: { batchMax: 50, waitMs: 2_000, pollMs: 5, lockTtlMs: 5_000, batchWindowMs: 0 },
    now: Date.now,
  };
});

describe("check-in micro-batching", () => {
  it("sends concurrent check-ins as one checkInBatch, then settleBatch with the next nonce", async () => {
    const results = await Promise.all(attendees.map((a) => relayCheckIns(deps, [checkIn(a)])));
    expect(state.sent).toHaveLength(2);

    const [checkInTx, settleTx] = state.sent.map(decodeSent);
    expect(checkInTx.tx.nonce).toBe(7);
    expect(settleTx.tx.nonce).toBe(8);
    expect(checkInTx.tx.chainId).toBe(qieTestnet.id);
    expect(checkInTx.tx.gasPrice).toBe(1_100_000_000n);
    expect(checkInTx.call.functionName).toBe("checkInBatch");
    expect((checkInTx.call.args?.[0] as readonly CheckInData[]).map((d) => d.attendee)).toEqual(attendees);

    expect(settleTx.call.functionName).toBe("settleBatch");
    const settleItems = settleTx.call.args?.[0] as readonly { campaignId: bigint; eventId: bigint; attendee: Address }[];
    expect(settleItems).toHaveLength(attendees.length * 2);
    expect(new Set(settleItems.map((s) => s.campaignId))).toEqual(new Set([3n, 4n]));
    expect(settleTx.tx.gas).toBe(settleGasLimit(10));

    const hashes = new Set(results.map(([r]) => (r.ok ? r.txHash : null)));
    expect(hashes.size).toBe(1);
    expect([...hashes][0]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("answers as soon as the check-in is broadcast and settles afterwards with the next nonce", async () => {
    const later: (() => Promise<void>)[] = [];
    const [result] = await relayCheckIns({ ...deps, background: (task) => void later.push(task) }, [checkIn(attendees[0])]);
    expect(result.ok).toBe(true);
    expect(state.sent).toHaveLength(1);
    // The lock is still held for the settlement, so nobody else can take the next nonce meanwhile.
    expect(await tryLock(kv, relayLockKey(deps.chain), 5_000)).toBeNull();
    await later[0]();
    expect(state.sent).toHaveLength(2);
    expect(decodeSent(state.sent[1]).tx.nonce).toBe((decodeSent(state.sent[0]).tx.nonce ?? 0) + 1);
    expect(await tryLock(kv, relayLockKey(deps.chain), 5_000)).not.toBeNull();
  });

  it("returns the registry status for items the batch would reject and sends the rest", async () => {
    state.reject.set(attendees[1].toLowerCase(), 1);
    const results = await relayCheckIns(deps, attendees.slice(0, 3).map((a) => checkIn(a)));
    expect(results[1]).toEqual({ ok: false, status: 1 });
    expect(results[0].ok && results[2].ok).toBe(true);
    const { call } = decodeSent(state.sent[0]);
    expect((call.args?.[0] as readonly CheckInData[]).map((d) => d.attendee)).toEqual([attendees[0], attendees[2]]);
  });

  it("sends a duplicate (event, attendee) once and gives both requests the same result", async () => {
    const [a, b] = await Promise.all([relayCheckIns(deps, [checkIn(attendees[0])]), relayCheckIns(deps, [checkIn(attendees[0])])]);
    expect(a).toEqual(b);
    expect((decodeSent(state.sent[0]).call.args?.[0] as readonly CheckInData[]).length).toBe(1);
  });

  it("waits while another instance holds the lock, then goes out", async () => {
    const held = await tryLock(kv, relayLockKey(deps.chain), 5_000);
    const pending = relayCheckIns(deps, [checkIn(attendees[0])]);
    await new Promise((r) => setTimeout(r, 30));
    expect(state.sent).toHaveLength(0);
    await held?.release();
    const [result] = await pending;
    expect(result.ok).toBe(true);
  });

  it("times out with a clear error and leaves the item queued for the next flush", async () => {
    await tryLock(kv, relayLockKey(deps.chain), 60_000);
    await expect(relayCheckIns({ ...deps, options: { ...deps.options, waitMs: 50 } }, [checkIn(attendees[0])])).rejects.toMatchObject({
      status: 504,
      copy: { code: "relay_timeout" },
    });
    expect(await kv.llen(`relay:q:${qieTestnet.id}`)).toBe(1);
  });

  it("skips settlement when no campaign pays for the event", async () => {
    await relayCheckIns({ ...deps, campaignsFor: async () => [] }, [checkIn(attendees[0])]);
    expect(state.sent).toHaveLength(1);
  });

  it("still reports the check-in when the campaign lookup fails", async () => {
    const [result] = await relayCheckIns({ ...deps, campaignsFor: async () => Promise.reject(new Error("db down")) }, [checkIn(attendees[0])]);
    expect(result.ok).toBe(true);
    expect(state.sent).toHaveLength(1);
  });

  it("puts items back when the lock is lost before sending", async () => {
    await kv.rpush(`relay:q:${qieTestnet.id}`, [JSON.stringify({ id: "x", d: { ...checkIn(attendees[0]), eventId: "1", doorTime: "1" } })]);
    const lock = await tryLock(kv, relayLockKey(deps.chain), 5_000);
    if (!lock) throw new Error("lock");
    await kv.del(relayLockKey(deps.chain));
    expect((await flushOnce(deps, lock)).processed).toBe(0);
    expect(state.sent).toHaveLength(0);
    expect(await kv.llen(`relay:q:${qieTestnet.id}`)).toBe(1);
  });
});

describe("nonce management", () => {
  async function sendOne(): Promise<number> {
    const lock = await tryLock(kv, relayLockKey(deps.chain), 5_000);
    if (!lock) throw new Error("lock");
    const { sent, error } = await sendSequential(deps.chain, kv, lock, [{ to: registry, data: "0x", gas: 50_000n, label: "t" }]);
    await lock.release();
    if (error) throw error;
    return sent[0].nonce;
  }

  it("never reuses a nonce when the RPC's pending count lags behind", async () => {
    expect(await sendOne()).toBe(7);
    // The chain still says 7 (the node has not seen our transaction); Redis knows 8 is next.
    expect(await sendOne()).toBe(8);
  });

  it("trusts the chain again once the stored nonce is old", async () => {
    const key = `relay:nonce:${qieTestnet.id}:${relayer.address.toLowerCase()}`;
    await kv.set(key, JSON.stringify({ nonce: 40, at: Date.now() - 120_000 }));
    expect(await sendOne()).toBe(7);
  });

  it("resyncs and retries once when the node says the nonce is too low", async () => {
    state.failNextSendWith = "invalid nonce; got 7, expected 9: invalid sequence";
    state.nonceAfterFail = 9;
    expect(await sendOne()).toBe(9);
    expect(parseTransaction(state.sent[0]).nonce).toBe(9);
  });

  it("treats an already known transaction as sent", async () => {
    state.failNextSendWith = "already known";
    expect(await sendOne()).toBe(7);
    expect(await sendOne()).toBe(8);
  });

  it("lets the relayer call only refreshClaim on the bond", async () => {
    const lock = await tryLock(kv, relayLockKey(deps.chain), 5_000);
    if (!lock) throw new Error("lock");
    const refresh = encodeFunctionData({ abi: bondAbi, functionName: "refreshClaim", args: [7n] });
    const { sent } = await sendSequential(deps.chain, kv, lock, [{ to: bond, data: refresh, gas: 100_000n, label: "refresh" }]);
    expect(sent).toHaveLength(1);
    const other = encodeFunctionData({ abi: bondAbi, functionName: "claimDeposit" });
    await expect(sendSequential(deps.chain, kv, lock, [{ to: bond, data: other, gas: 1n, label: "x" }])).rejects.toBeInstanceOf(RelayTargetError);
  });

  it("sends refreshClaim right behind a settlement that may have paid through a bond", async () => {
    await relayCheckIns({ ...deps, challengesAfter: async (items) => (items.length > 0 ? [5n] : []) }, [checkIn(attendees[0])]);
    expect(state.sent).toHaveLength(3);
    const third = decodeSent(state.sent[2]);
    expect(third.tx.to?.toLowerCase()).toBe(bond.toLowerCase());
    expect(third.tx.nonce).toBe(9);
  });

  it("refuses to sign for any contract other than the registry and the vault", async () => {
    const lock = await tryLock(kv, relayLockKey(deps.chain), 5_000);
    if (!lock) throw new Error("lock");
    await expect(sendSequential(deps.chain, kv, lock, [{ to: "0x3000000000000000000000000000000000000003", data: "0x", gas: 1n, label: "x" }])).rejects.toBeInstanceOf(
      RelayTargetError,
    );
    expect(state.sent).toHaveLength(0);
  });
});

describe("status copy", () => {
  const banned = /[—–!]|seamless|revolutionize|unlock|empower|leverage|effortless|supercharge/i;

  it("maps every check-in and settlement status to plain copy", () => {
    for (let s = 1; s <= 10; s++) {
      const copy = checkInStatusCopy(s);
      expect(copy.code).not.toBe("check_in_rejected");
      expect(copy.message).toMatch(/^[A-Z].*\.$/);
      expect(copy.action).toMatch(/^[A-Z].*\.$/);
      expect(`${copy.message} ${copy.action}`).not.toMatch(banned);
    }
    for (let s = 1; s <= 12; s++) {
      const copy = settleStatusCopy(s);
      expect(copy.code).toMatch(/^settle_/);
      expect(`${copy.message} ${copy.action}`).not.toMatch(banned);
    }
    expect(checkInStatusCopy(6).code).toBe("stale");
    expect(settleStatusCopy(8).code).toBe("settle_needs_qie_id");
    expect(checkInStatusCopy(99).code).toBe("check_in_rejected");
  });
});
