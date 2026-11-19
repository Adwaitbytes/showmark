import { encodeFunctionData, formatEther, type Address, type Hex } from "viem";
import { registryAbi } from "@/lib/chain/abi";
import { AppError, COMMON_ERRORS, RELAY_ERRORS } from "../errors";
import type { KeyValueStore } from "../kv";
import { sleep, tryLock, type Lock } from "../lock";
import { log } from "../log";
import type { CheckInData } from "../schemas";
import { LockLostError, sendSequential, type RelayerChain, type SentTx } from "./sender";
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

/** Drains one batch from the queue and sends it. The caller holds the relayer lock. Returns items processed. */
export async function flushOnce(deps: RelayerDeps, lock: Lock): Promise<number> {
  const { chain, kv } = deps;
  const started = deps.now();
  const raw = await kv.lpop(queueKey(chain), deps.options.batchMax);
  if (raw.length === 0) return 0;
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

  let statuses: number[];
  try {
    statuses = await simulateCheckIns(chain, groups.map((g) => g.item));
    if (statuses.length !== groups.length) throw new Error(`checkInBatch returned ${statuses.length} statuses for ${groups.length} items`);
  } catch (error) {
    log.error("relayer.batch_simulation_failed", { items: groups.length, error });
    await writeResults(deps, queued.map((q) => q.id), { ok: false, error: "send_failed" });
    return queued.length;
  }

  const accepted = groups.filter((_, i) => statuses[i] === 0);
  await Promise.all(groups.map((g, i) => (statuses[i] === 0 ? null : writeResults(deps, g.ids, { ok: false, status: statuses[i] }))));
  if (accepted.length === 0) return queued.length;

  const items = accepted.map((g) => g.item);
  const data = encodeFunctionData({ abi: registryAbi, functionName: "checkInBatch", args: [items] });
  let gas: bigint;
  try {
    const estimate = await chain.client.estimateGas({ account: chain.account.address, to: chain.registry, data });
    gas = (estimate * 125n) / 100n + 20_000n;
  } catch (error) {
    log.error("relayer.batch_estimate_failed", { items: items.length, error });
    await writeResults(deps, accepted.flatMap((g) => g.ids), { ok: false, error: "send_failed" });
    return queued.length;
  }

  const settleItems: SettleItem[] = [];
  const attendeesByEvent = new Map<bigint, Address[]>();
  for (const item of items) attendeesByEvent.set(item.eventId, [...(attendeesByEvent.get(item.eventId) ?? []), item.attendee]);
  for (const [eventId, attendees] of attendeesByEvent) {
    try {
      settleItems.push(...settleItemsFor(eventId, attendees, await deps.campaignsFor(eventId)));
    } catch (error) {
      // Presence is recorded regardless; the cron retries settlement for anything left unpaid.
      log.warn("relayer.campaign_lookup_failed", { eventId, error });
    }
  }

  const refreshes = await followUpRefreshes(deps, settleItems);
  const { sent, error } = await sendSequential(
    chain,
    kv,
    lock,
    [{ to: chain.registry, data, gas, label: `checkInBatch(${items.length})` }, ...settleRequests(chain, settleItems), ...refreshes],
    deps.now,
  );
  const checkInTx: SentTx | undefined = sent[0];
  if (!checkInTx) {
    if (error instanceof LockLostError) {
      // Nothing was sent; give the items back so the next lock holder sends them.
      await kv.rpush(queueKey(chain), raw);
      log.warn("relayer.lock_lost_requeued", { items: raw.length });
      return 0;
    }
    await writeResults(deps, accepted.flatMap((g) => g.ids), { ok: false, error: "send_failed" });
    return queued.length;
  }

  await writeResults(deps, accepted.flatMap((g) => g.ids), { ok: true, txHash: checkInTx.hash });
  if (error) log.warn("relayer.settlement_not_sent", { checkInTx: checkInTx.hash, settleItems: settleItems.length, error });
  log.info("relayer.batch", {
    queued: queued.length,
    accepted: items.length,
    rejected: groups.length - accepted.length,
    settleItems: settleItems.length,
    txs: sent.map((s) => s.hash),
    ms: deps.now() - started,
  });

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
  return queued.length;
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

/** Takes the lock if it is free and flushes one batch. Returns false when someone else holds the lock. */
export async function flushIfFree(deps: RelayerDeps): Promise<boolean> {
  const lock = await tryLock(deps.kv, relayLockKey(deps.chain), deps.options.lockTtlMs);
  if (!lock) return false;
  try {
    if (deps.options.batchWindowMs > 0) await sleep(deps.options.batchWindowMs);
    await flushOnce(deps, lock);
  } finally {
    await lock.release();
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
