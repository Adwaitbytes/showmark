import { encodeFunctionData, formatEther, type Address, type Hex } from "viem";
import { registryAbi } from "@/lib/chain/abi";
import { AppError, COMMON_ERRORS, RELAY_ERRORS } from "../errors";
import type { KeyValueStore } from "../kv";
import { sleep, tryLock, type Lock } from "../lock";
import { log } from "../log";
import type { CheckInData } from "../schemas";
import { LockLostError, prepareSend, sendSequential, type PreparedSend, type RelayerChain, type SentTx } from "./sender";
import { refreshClaimRequest } from "./claims";
import { settleItemsFor, settleRequests, type SettleItem } from "./settle";

// Check-ins wait in a Redis list. Whoever holds the relayer lock drains up to 50 of them into one checkInBatch,
// sends it, and sends settleBatch for every campaign approved for those events with the next nonce. Everyone
// else polls for their result. Under load this batches naturally: items pile up while a batch is in flight.

export interface RelayOptions {
  /** Items per checkInBatch. */
  batchMax: number;
  /** How long a request waits for its result before answering 504. */
  waitMs: number;
  pollMs: number;
  lockTtlMs: number;
  /** Optional pause after taking the lock to let a burst collect into one batch. */
  batchWindowMs: number;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = { batchMax: 50, waitMs: 20_000, pollMs: 120, lockTtlMs: 5_000, batchWindowMs: 0 };

export interface RelayerDeps {
  chain: RelayerChain;
  kv: KeyValueStore;
  /** Campaigns that can still pay for an event: approved, or open with the organizer opted in. */
  campaignsFor(eventId: bigint): Promise<bigint[]>;
  /** Bond challenges to refresh right after these settlements (audit I4-01). Omitted when there is no bond. */
  challengesAfter?(items: SettleItem[]): Promise<bigint[]>;
  /** Called after a batch with check-ins in it is sent. Used to stamp the door queue. */
  onSent?(items: CheckInData[], txHash: Hex): Promise<void>;
  /** Runs work after the response (Next.js after()). Without it the work is awaited inline. */
  background?(task: () => Promise<void>): void;
  options: RelayOptions;
  now(): number;
}

export type RelayResult = { ok: true; txHash: Hex } | { ok: false; status: number } | { ok: false; error: "send_failed" };

interface WireCheckIn {
  eventId: string;
  attendee: Address;
  mode: 1 | 2;
  doorTime: string;
  ticket: Address;
  attendeeSig: Hex;
  doorSig: Hex;
  ticketSig: Hex;
}

interface Queued {
  id: string;
  d: WireCheckIn;
}

const RESULT_TTL_MS = 120_000;
const LOW_BALANCE_WEI = 5n * 10n ** 18n;
const BALANCE_CHECK_MS = 60_000;
const lastBalanceCheck = new Map<string, number>();

const queueKey = (chain: RelayerChain) => `relay:q:${chain.chainId}`;
const resultKey = (chain: RelayerChain, id: string) => `relay:r:${chain.chainId}:${id}`;
export const relayLockKey = (chain: RelayerChain) => `relay:lock:${chain.chainId}:${chain.account.address.toLowerCase()}`;

function toWire(d: CheckInData): WireCheckIn {
  return { ...d, eventId: d.eventId.toString(), doorTime: d.doorTime.toString() };
}

function fromWire(w: WireCheckIn): CheckInData {
  return { ...w, eventId: BigInt(w.eventId), doorTime: BigInt(w.doorTime) };
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** checkInBatch as an eth_call from the relayer. It never reverts per item, so each status code is exact. */
export async function simulateCheckIns(chain: RelayerChain, items: CheckInData[]): Promise<number[]> {
  try {
    const { result } = await chain.client.simulateContract({
      address: chain.registry,
      abi: registryAbi,
      functionName: "checkInBatch",
      args: [items],
      account: chain.account.address,
    });
    return [...result];
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
}

async function writeResults(deps: RelayerDeps, ids: string[], result: RelayResult): Promise<void> {
  const value = JSON.stringify(result);
  await Promise.all(ids.map((id) => deps.kv.set(resultKey(deps.chain, id), value, { px: RESULT_TTL_MS })));
}

async function warnIfLowBalance(chain: RelayerChain, now: number): Promise<void> {
  const key = `${chain.chainId}:${chain.account.address}`;
  if (now - (lastBalanceCheck.get(key) ?? 0) < BALANCE_CHECK_MS) return;
  lastBalanceCheck.set(key, now);
  const balance = await chain.client.getBalance({ address: chain.account.address });
  if (balance < LOW_BALANCE_WEI) {
    log.warn("relayer.low_balance", { address: chain.account.address, balance: formatEther(balance), thresholdQie: formatEther(LOW_BALANCE_WEI) });
  }
}

export interface FlushResult {
  /** Queue items taken (0 means the queue was empty or the items were put back). */
  processed: number;
  /**
   * Work that follows the check-in broadcast: settlement, claim refreshes, door queue stamps, balance check. It
   * must run while the relayer lock is still held (it continues the nonce sequence); callers release afterwards.
   */
  tail: (() => Promise<void>) | null;
}

/** Fallback gas when estimation fails: measured checkInBatch(1) used about 140k on anvil. */
const CHECK_IN_GAS_BASE = 80_000n;
const CHECK_IN_GAS_PER_ITEM = 150_000n;

/**
 * Drains one batch from the queue and broadcasts it. The caller holds the relayer lock. Results are written as
 * soon as the check-in transaction is broadcast, never after mining and never after the settlement, so the
 * attendee's request answers in about one RPC round trip after simulation.
 */
export async function flushOnce(deps: RelayerDeps, lock: Lock): Promise<FlushResult> {
  const { chain, kv } = deps;
  const started = deps.now();
  const timings: Record<string, number> = {};
  const mark = (name: string, since: number) => (timings[name] = deps.now() - since);

  const raw = await kv.lpop(queueKey(chain), deps.options.batchMax);
  mark("dequeueMs", started);
  if (raw.length === 0) return { processed: 0, tail: null };
  const queued = raw.map((r) => JSON.parse(r) as Queued);

  // One (event, attendee) per batch: later duplicates share the first one's result.
  const byKey = new Map<string, { item: CheckInData; ids: string[] }>();
  for (const q of queued) {
    const item = fromWire(q.d);
    const key = `${item.eventId}:${item.attendee.toLowerCase()}`;
    const group = byKey.get(key);
    if (group) group.ids.push(q.id);
    else byKey.set(key, { item, ids: [q.id] });
  }
  const groups = [...byKey.values()];
  const all = groups.map((g) => g.item);

  // Simulation, gas estimate, nonce and gas price are independent reads: one round trip of latency together.
  const t1 = deps.now();
  let statuses: number[];
  let estimate: bigint | null;
  let prepared: PreparedSend;
  try {
    [statuses, estimate, prepared] = await Promise.all([
      simulateCheckIns(chain, all),
      chain.client
        .estimateGas({ account: chain.account.address, to: chain.registry, data: encodeFunctionData({ abi: registryAbi, functionName: "checkInBatch", args: [all] }) })
        .catch((error: unknown) => {
          log.warn("relayer.batch_estimate_failed", { items: all.length, error });
          return null;
        }),
      prepareSend(chain, kv, deps.now()),
    ]);
    if (statuses.length !== groups.length) throw new Error(`checkInBatch returned ${statuses.length} statuses for ${groups.length} items`);
  } catch (error) {
    log.error("relayer.batch_simulation_failed", { items: groups.length, error });
    await writeResults(deps, queued.map((q) => q.id), { ok: false, error: "send_failed" });
    return { processed: queued.length, tail: null };
  }
  mark("prepareMs", t1);

  const accepted = groups.filter((_, i) => statuses[i] === 0);
  await Promise.all(groups.map((g, i) => (statuses[i] === 0 ? null : writeResults(deps, g.ids, { ok: false, status: statuses[i] }))));
  if (accepted.length === 0) return { processed: queued.length, tail: null };

  const items = accepted.map((g) => g.item);
  const data = encodeFunctionData({ abi: registryAbi, functionName: "checkInBatch", args: [items] });
  // The estimate covered every item, including rejected ones, so it is an upper bound for the accepted subset.
  const gas = estimate !== null ? (estimate * 125n) / 100n + 20_000n : CHECK_IN_GAS_BASE + CHECK_IN_GAS_PER_ITEM * BigInt(items.length);

  const t2 = deps.now();
  const { sent, error } = await sendSequential(chain, kv, lock, [{ to: chain.registry, data, gas, label: `checkInBatch(${items.length})` }], deps.now, prepared);
  mark("sendMs", t2);
  const checkInTx: SentTx | undefined = sent[0];
  if (!checkInTx) {
    if (error instanceof LockLostError) {
      // Nothing was sent; give the items back so the next lock holder sends them.
      await kv.rpush(queueKey(chain), raw);
      log.warn("relayer.lock_lost_requeued", { items: raw.length });
      return { processed: 0, tail: null };
    }
    await writeResults(deps, accepted.flatMap((g) => g.ids), { ok: false, error: "send_failed" });
    return { processed: queued.length, tail: null };
  }
  await writeResults(deps, accepted.flatMap((g) => g.ids), { ok: true, txHash: checkInTx.hash });
  mark("totalMs", started);
  log.info("relayer.batch", { queued: queued.length, accepted: items.length, rejected: groups.length - accepted.length, tx: checkInTx.hash, ...timings });

  const tail = async () => {
    const t3 = deps.now();
    if (!(await lock.extend(deps.options.lockTtlMs))) {
      log.warn("relayer.settlement_not_sent", { checkInTx: checkInTx.hash, reason: "lock_lost" });
      return;
    }
    const settleItems: SettleItem[] = [];
    const attendeesByEvent = new Map<bigint, Address[]>();
    for (const item of items) attendeesByEvent.set(item.eventId, [...(attendeesByEvent.get(item.eventId) ?? []), item.attendee]);
    for (const [eventId, attendees] of attendeesByEvent) {
      try {
        settleItems.push(...settleItemsFor(eventId, attendees, await deps.campaignsFor(eventId)));
      } catch (lookupError) {
        // Presence is recorded regardless; the cron retries settlement for anything left unpaid.
        log.warn("relayer.campaign_lookup_failed", { eventId, error: lookupError });
      }
    }
    const followUps = [...settleRequests(chain, settleItems), ...(await followUpRefreshes(deps, settleItems))];
    const after = await sendSequential(chain, kv, lock, followUps, deps.now);
    if (after.error) log.warn("relayer.settlement_not_sent", { checkInTx: checkInTx.hash, settleItems: settleItems.length, error: after.error });
    log.info("relayer.settlement", { checkInTx: checkInTx.hash, settleItems: settleItems.length, txs: after.sent.map((s) => s.hash), ms: deps.now() - t3 });

    if (deps.onSent) {
      try {
        await deps.onSent(items, checkInTx.hash);
      } catch (hookError) {
        log.warn("relayer.on_sent_failed", { error: hookError });
      }
    }
    try {
      await warnIfLowBalance(chain, deps.now());
    } catch (balanceError) {
      log.warn("relayer.balance_check_failed", { error: balanceError });
    }
  };
  return { processed: queued.length, tail };
}

/**
 * refreshClaim transactions to send right behind a settlement, so a challenged organizer's claim always covers
 * what the campaign has paid through their bond. A lookup failure is logged; the cron sweep catches up.
 */
export async function followUpRefreshes(deps: RelayerDeps, settleItems: SettleItem[]) {
  if (!deps.challengesAfter || settleItems.length === 0) return [];
  try {
    return (await deps.challengesAfter(settleItems)).map((id) => refreshClaimRequest(deps.chain, id));
  } catch (error) {
    log.warn("relayer.claim_refresh_lookup_failed", { items: settleItems.length, error });
    return [];
  }
}

/**
 * Takes the lock if it is free and flushes one batch. Returns false when someone else holds the lock. The batch's
 * results are written before this returns; its settlement tail keeps the lock and runs in `deps.background` (the
 * route's after()) so the request that flushed answers right away, or inline when no background runner is set.
 */
export async function flushIfFree(deps: RelayerDeps): Promise<boolean> {
  const lock = await tryLock(deps.kv, relayLockKey(deps.chain), deps.options.lockTtlMs);
  if (!lock) return false;
  let tail: FlushResult["tail"] = null;
  try {
    if (deps.options.batchWindowMs > 0) await sleep(deps.options.batchWindowMs);
    ({ tail } = await flushOnce(deps, lock));
  } finally {
    if (!tail) await lock.release();
  }
  if (tail) {
    const run = tail;
    const finish = async () => {
      try {
        await run();
      } catch (error) {
        log.error("relayer.tail_failed", { error });
      } finally {
        await lock.release();
      }
    };
    if (deps.background) deps.background(finish);
    else await finish();
  }
  return true;
}

/**
 * Queues check-ins that already passed simulation and waits for each one's result. A result of
 * `{ ok: false, status }` means the network state changed between simulation and sending (for example the
 * same pass checked in twice at once). Times out with AppError(504); the items stay queued and still go out.
 */
export async function relayCheckIns(deps: RelayerDeps, items: CheckInData[]): Promise<RelayResult[]> {
  const { chain, kv } = deps;
  const queued: Queued[] = items.map((d) => ({ id: randomId(), d: toWire(d) }));
  await kv.rpush(queueKey(chain), queued.map((q) => JSON.stringify(q)));

  const results = new Map<string, RelayResult>();
  const deadline = deps.now() + deps.options.waitMs;
  for (;;) {
    const pending = queued.filter((q) => !results.has(q.id));
    const values = await kv.mget(pending.map((q) => resultKey(chain, q.id)));
    values.forEach((v, i) => {
      if (v) results.set(pending[i].id, JSON.parse(v) as RelayResult);
    });
    if (results.size === queued.length) break;
    if (deps.now() >= deadline) {
      log.warn("relayer.wait_timeout", { items: queued.length, done: results.size });
      throw new AppError(504, RELAY_ERRORS.queueTimeout);
    }
    if (!(await flushIfFree(deps))) await sleep(deps.options.pollMs);
  }
  return queued.map((q) => results.get(q.id) as RelayResult);
}

/** Sends whatever is left in the queue, for the cron route. */
export async function drainQueue(deps: RelayerDeps, maxBatches = 10): Promise<number> {
  let batches = 0;
  while (batches < maxBatches && (await deps.kv.llen(queueKey(deps.chain))) > 0) {
    if (!(await flushIfFree(deps))) break;
    batches += 1;
  }
  return batches;
}
