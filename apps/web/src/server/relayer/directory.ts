import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { KeyValueStore } from "../kv";
import { campaignEligibleFor, openCampaignIds, SETTLE_GRACE_MS } from "../payouts";

// The relay directory: everything the check-in path needs from the index (each live event's organizer and the
// campaigns that pay for it, the open-to-bonded campaigns, open challenges), kept as one JSON document in Redis.
// The indexer republishes it whenever it applies new logs and the cron republishes it every run, so relaying a
// check-in costs one Redis read instead of Postgres queries that can wait on a Neon cold start.

export interface RelayDirectory {
  builtAt: number;
  /** By event id: lowercase organizer and the ids of campaigns that pay for the event per the index. */
  events: Record<string, { organizer: string; campaigns: string[] }>;
  /** Open-to-bonded campaigns that can still pay; the relayer confirms opt-ins on chain. */
  open: string[];
  challenges: { id: string; campaignId: string; organizer: string }[];
}

/** Check-ins are accepted until endsAt + 3 days (door-scans-you late submission); keep a day of margin. */
const EVENT_WINDOW_MS = 4 * 24 * 60 * 60_000;

const directoryKey = (chainId: number) => `relay:directory:${chainId}`;

export async function buildRelayDirectory(db: Db, now: number = Date.now()): Promise<RelayDirectory> {
  const live = await db
    .select({ id: t.events.id, organizer: t.events.organizer })
    .from(t.events)
    .where(gte(t.events.endsAt, new Date(now - EVENT_WINDOW_MS)));
  const paying = await db
    .select({ eventId: t.events.id, campaignId: t.campaigns.id })
    .from(t.events)
    .innerJoin(t.campaigns, campaignEligibleFor(t.events.id, t.events.organizer))
    .where(and(gte(t.events.endsAt, new Date(now - EVENT_WINDOW_MS)), gte(t.campaigns.endsAt, new Date(now - SETTLE_GRACE_MS))))
    .orderBy(asc(t.campaigns.id));
  const events: RelayDirectory["events"] = {};
  for (const e of live) events[e.id.toString()] = { organizer: e.organizer, campaigns: [] };
  for (const p of paying) events[p.eventId.toString()]?.campaigns.push(p.campaignId.toString());
  const challenges = await db
    .select({ id: t.challenges.id, campaignId: t.challenges.campaignId, organizer: t.challenges.organizer })
    .from(t.challenges)
    .where(eq(t.challenges.resolved, false));
  return {
    builtAt: now,
    events,
    open: (await openCampaignIds(db)).map(String),
    challenges: challenges.map((c) => ({ id: c.id.toString(), campaignId: c.campaignId.toString(), organizer: c.organizer })),
  };
}

export async function publishRelayDirectory(kv: KeyValueStore, chainId: number, db: Db): Promise<RelayDirectory> {
  const dir = await buildRelayDirectory(db);
  await kv.set(directoryKey(chainId), JSON.stringify(dir));
  return dir;
}

export async function readRelayDirectory(kv: KeyValueStore, chainId: number): Promise<RelayDirectory | null> {
  const raw = await kv.get(directoryKey(chainId));
  return raw ? (JSON.parse(raw) as RelayDirectory) : null;
}
