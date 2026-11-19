import { asc, eq, isNull, lt, or } from "drizzle-orm";
import { getAddress } from "viem";
import { chainContext, type ChainContext } from "../chain";
import { getDatabase, type Database } from "../db/client";
import * as t from "../db/schema";
import { getStore, type KeyValueStore } from "../kv";
import { log } from "../log";
import { hadActivityBefore } from "../qie/blockscout";
import { holdsQieId, nameOf } from "../qie/names";

const NAME_REFRESH_MS = 6 * 60 * 60_000;

export interface ProfileDeps {
  ctx: ChainContext;
  database: Database;
  kv: KeyValueStore;
  fetchImpl: typeof fetch;
}

function defaults(partial?: Partial<ProfileDeps>): ProfileDeps {
  return {
    ctx: partial?.ctx ?? chainContext(),
    database: partial?.database ?? getDatabase(),
    kv: partial?.kv ?? getStore(),
    fetchImpl: partial?.fetchImpl ?? fetch,
  };
}

export interface ProfileRefreshResult {
  firstSeenChecked: number;
  namesChecked: number;
  failures: number;
}

/**
 * Fills in what the indexer cannot know from logs alone: whether a wallet had any activity before its first
 * Showmark interaction (Blockscout), and its QIE ID name and holdings (Zone). Each address that fails is logged
 * and left for the next run, so one slow explorer call never blocks the rest.
 */
export async function refreshProfiles(limit: number, partial?: Partial<ProfileDeps>): Promise<ProfileRefreshResult> {
  const { ctx, database, kv, fetchImpl } = defaults(partial);
  const { db } = database;
  const result: ProfileRefreshResult = { firstSeenChecked: 0, namesChecked: 0, failures: 0 };

  const unchecked = await db
    .select({ address: t.profiles.address, firstSeenBlock: t.profiles.firstSeenBlock })
    .from(t.profiles)
    .where(isNull(t.profiles.firstSeenViaShowmark))
    .orderBy(asc(t.profiles.firstSeenBlock))
    .limit(limit);
  for (const row of unchecked) {
    try {
      const before = await hadActivityBefore(getAddress(row.address), row.firstSeenBlock, fetchImpl);
      await db.update(t.profiles).set({ firstSeenViaShowmark: !before, updatedAt: new Date() }).where(eq(t.profiles.address, row.address));
      result.firstSeenChecked += 1;
    } catch (error) {
      result.failures += 1;
      log.warn("profiles.first_seen_failed", { address: row.address, error });
    }
  }

  const stale = await db
    .select({ address: t.profiles.address })
    .from(t.profiles)
    .where(or(isNull(t.profiles.holdsQieId), lt(t.profiles.updatedAt, new Date(Date.now() - NAME_REFRESH_MS))))
    .orderBy(asc(t.profiles.updatedAt))
    .limit(limit);
  for (const row of stale) {
    try {
      const address = getAddress(row.address);
      const [qieName, holds] = await Promise.all([nameOf(address, { ctx, kv }), holdsQieId(address, { ctx, kv })]);
      await db.update(t.profiles).set({ qieName, holdsQieId: holds, updatedAt: new Date() }).where(eq(t.profiles.address, row.address));
      result.namesChecked += 1;
    } catch (error) {
      result.failures += 1;
      log.warn("profiles.name_failed", { address: row.address, error });
    }
  }
  return result;
}
