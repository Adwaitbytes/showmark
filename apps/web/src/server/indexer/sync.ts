import { eq } from "drizzle-orm";
import { after } from "next/server";
import type { Address } from "viem";
import { chainContext, contractsDeployed, type ChainContext } from "../chain";
import { getDatabase, type Database } from "../db/client";
import * as t from "../db/schema";
import { teamAddresses } from "../env";
import { AppError } from "../errors";
import { getStore, type KeyValueStore } from "../kv";
import { tryLock } from "../lock";
import { log } from "../log";
import { buildStatements, syncStateStatement } from "./apply";
import { decodeShowmarkLogs } from "./decode";
import { refreshProfiles } from "./profiles";

/**
 * eth_getLogs block span. Probed on 19 Nov 2026: rpc1..rpc5 mainnet and rpc1 testnet accept at most 10,001 blocks
 * per call and reject `toBlock - fromBlock > 10000` with "maximum [from, to] blocks distance: 10000".
 * Ranges here are 10,000 blocks, one under the limit.
 */
export const MAX_LOG_BLOCK_SPAN = 10_000n;

const BLOCK_FETCH_CONCURRENCY = 8;

export interface SyncDeps {
  ctx: ChainContext;
  database: Database;
  team: ReadonlySet<Address>;
}

export interface SyncOptions {
  /** Stop after this many getLogs ranges. */
  maxChunks: number;
  /** Stop starting new ranges after this many milliseconds. */
  budgetMs: number;
}

export interface SyncResult {
  fromBlock: string;
  toBlock: string;
  head: string;
  logs: number;
  chunks: number;
  caughtUp: boolean;
}

function defaultDeps(): SyncDeps {
  return { ctx: chainContext(), database: getDatabase(), team: teamAddresses() };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The first block that still needs indexing. Refuses to mix data from a different deployment. */
async function nextBlock(deps: SyncDeps): Promise<bigint> {
  const { ctx, database } = deps;
  const rows = await database.db.select().from(t.syncState).where(eq(t.syncState.chainId, ctx.chainId));
  const ours = new Set([ctx.registry.toLowerCase(), ctx.vault.toLowerCase()]);
  const foreign = rows.filter((r) => !ours.has(r.contract));
  if (foreign.length > 0) {
    // Operators clear the old deployment's rows with resetIndex() below, then the indexer starts from deployBlock.
    log.error("indexer.contract_mismatch", { chainId: ctx.chainId, indexed: foreign.map((r) => r.contract), configured: [...ours], fix: "resetIndex" });
    throw new AppError(503, {
      code: "index_mismatch",
      message: "Showmark is switching to new contracts and its records are being rebuilt.",
      action: "Try again in a few minutes.",
    });
  }
  const mine = rows.filter((r) => ours.has(r.contract));
  if (mine.length < ours.size) return ctx.deployBlock;
  const last = mine.reduce((min, r) => (r.lastBlock < min ? r.lastBlock : min), mine[0].lastBlock);
  return last + 1n > ctx.deployBlock ? last + 1n : ctx.deployBlock;
}

/** Indexes registry and vault logs forward from the last synced block. CometBFT finality means no reorg handling. */
export async function syncOnce(options: SyncOptions, deps: SyncDeps = defaultDeps()): Promise<SyncResult> {
  const { ctx, database, team } = deps;
  const started = Date.now();
  // viem caches the block number for the client's polling interval; the indexer needs the real head.
  const head = await ctx.client.getBlockNumber({ cacheTime: 0 });
  let from = await nextBlock(deps);
  const firstFrom = from;
  let chunks = 0;
  let total = 0;

  while (from <= head && chunks < options.maxChunks && Date.now() - started < options.budgetMs) {
    const to = from + MAX_LOG_BLOCK_SPAN - 1n < head ? from + MAX_LOG_BLOCK_SPAN - 1n : head;
    const raw = await ctx.client.getLogs({ address: [ctx.registry, ctx.vault], fromBlock: from, toBlock: to });
    const logs = decodeShowmarkLogs(raw, { registry: ctx.registry, vault: ctx.vault });
    const blocks = [...new Set(logs.map((l) => l.blockNumber))];
    const times = await mapLimit(blocks, BLOCK_FETCH_CONCURRENCY, async (blockNumber) => {
      const block = await ctx.client.getBlock({ blockNumber });
      return [blockNumber, new Date(Number(block.timestamp) * 1000)] as const;
    });
    const statements = buildStatements(database.db, logs, new Map(times), { teamAddresses: team });
    statements.push(syncStateStatement(database.db, ctx.chainId, [ctx.registry, ctx.vault], to));
    await database.batch(statements);
    if (logs.length > 0) log.info("indexer.range", { from, to, logs: logs.length, raw: raw.length });
    total += logs.length;
    chunks += 1;
    from = to + 1n;
  }

  return {
    fromBlock: firstFrom.toString(),
    toBlock: (from - 1n).toString(),
    head: head.toString(),
    logs: total,
    chunks,
    caughtUp: from > head,
  };
}

const FRESH_MS = 3_000;
const LOCK_MS = 15_000;

/**
 * Catch-up on read. At most one request syncs at a time (Redis lock), and only when the last sync finished more
 * than a block ago. Requests that do not get the lock read what is already indexed instead of waiting. Failures
 * are logged and the read continues with the data already indexed, so a slow RPC never takes a page down.
 */
export async function ensureFresh(options: { kv?: KeyValueStore; deps?: SyncDeps } = {}): Promise<void> {
  let deps: SyncDeps;
  let kv: KeyValueStore;
  try {
    deps = options.deps ?? defaultDeps();
    if (!contractsDeployed(deps.ctx)) return;
    kv = options.kv ?? getStore();
  } catch (error) {
    if (error instanceof AppError) {
      log.warn("indexer.catch_up_skipped", { reason: error.copy.code });
      return;
    }
    throw error;
  }
  const freshKey = `idx:fresh:${deps.ctx.chainId}`;
  if (await kv.get(freshKey)) return;
  const lock = await tryLock(kv, `idx:lock:${deps.ctx.chainId}`, LOCK_MS);
  if (!lock) return;
  try {
    const result = await syncOnce({ maxChunks: 3, budgetMs: 4_000 }, deps);
    if (result.caughtUp) await kv.set(freshKey, "1", { px: FRESH_MS });
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.warn("indexer.catch_up_failed", { error });
  } finally {
    await lock.release();
  }
  scheduleProfileRefresh(kv, deps);
}

const PROFILE_REFRESH_EVERY_MS = 60_000;

/**
 * Names and first-seen facts come from RPC and the explorer, so they are filled in after the response is sent
 * (Next.js `after`), at most once a minute, a few addresses at a time. Outside a request there is nothing to
 * run after, and the cron route does the same work on its own schedule.
 */
function scheduleProfileRefresh(kv: KeyValueStore, deps: SyncDeps): void {
  const task = async () => {
    const lock = await tryLock(kv, `idx:profiles:${deps.ctx.chainId}`, PROFILE_REFRESH_EVERY_MS);
    if (!lock) return;
    try {
      await refreshProfiles(5, { ctx: deps.ctx, database: deps.database, kv });
    } catch (error) {
      log.warn("indexer.profile_refresh_failed", { error });
    }
    // The lock is left to expire on purpose: it doubles as the once-a-minute throttle.
  };
  try {
    after(task);
  } catch (error) {
    log.debug("indexer.profile_refresh_not_scheduled", { reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Full catch-up for the cron route: holds the lock longer and runs until head or the time budget. */
export async function syncForCron(budgetMs: number, options: { kv?: KeyValueStore; deps?: SyncDeps } = {}): Promise<SyncResult | { skipped: string }> {
  if (!contractsDeployed(options.deps?.ctx ?? chainContext())) return { skipped: "not_deployed" };
  const deps = options.deps ?? defaultDeps();
  const kv = options.kv ?? getStore();
  const lock = await tryLock(kv, `idx:lock:${deps.ctx.chainId}`, budgetMs + 10_000);
  if (!lock) return { skipped: "locked" };
  try {
    return await syncOnce({ maxChunks: Number.MAX_SAFE_INTEGER, budgetMs }, deps);
  } finally {
    await lock.release();
  }
}

/** Removes every indexed row for this chain so the indexer starts again from the deploy block. Keeps door_queue. */
export async function resetIndex(database: Database, chainId: number): Promise<void> {
  const db = database.db;
  await database.batch([
    db.delete(t.presences),
    db.delete(t.events),
    db.delete(t.series),
    db.delete(t.links),
    db.delete(t.campaigns),
    db.delete(t.campaignEvents),
    db.delete(t.settlements),
    db.delete(t.settlementSkips),
    db.delete(t.fundings),
    db.delete(t.refunds),
    db.delete(t.withdrawals),
    db.delete(t.transactions),
    db.delete(t.profiles),
    db.delete(t.syncState).where(eq(t.syncState.chainId, chainId)),
  ]);
}
