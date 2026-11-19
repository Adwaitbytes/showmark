import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Passport } from "@/lib/api/types";
import type { Db } from "./db/client";
import * as t from "./db/schema";

/** Refunds open, and settlement closes, this long after a campaign ends (CampaignVault SETTLE_GRACE). */
export const SETTLE_GRACE_MS = 3 * 24 * 60 * 60_000;

/** The deployed vault math: fee is taken from gross, then the attendee share of what is left. */
export function attendeeShare(gross: bigint, feeBps: number, attendeeShareBps: number): bigint {
  const fee = (gross * BigInt(feeBps)) / 10_000n;
  return ((gross - fee) * BigInt(attendeeShareBps)) / 10_000n;
}

/**
 * Payouts this pass is still owed: an approved campaign whose rules the presence meets, with no settlement yet.
 * The latest skip status says why. Skips that can never succeed (caps reached, window passed) are not pending.
 */
export async function pendingFor(db: Db, pass: string): Promise<Passport["pending"]> {
  const rows = await db
    .select({ campaignId: t.campaigns.id, eventId: t.presences.eventId, status: t.settlementSkips.status, endsAt: t.campaigns.endsAt })
    .from(t.presences)
    .innerJoin(t.campaignEvents, and(eq(t.campaignEvents.eventId, t.presences.eventId), eq(t.campaignEvents.approved, true)))
    .innerJoin(t.campaigns, eq(t.campaigns.id, t.campaignEvents.campaignId))
    .leftJoin(
      t.settlements,
      and(eq(t.settlements.campaignId, t.campaigns.id), eq(t.settlements.eventId, t.presences.eventId), eq(t.settlements.attendee, t.presences.attendee)),
    )
    .leftJoin(
      t.settlementSkips,
      and(eq(t.settlementSkips.campaignId, t.campaigns.id), eq(t.settlementSkips.eventId, t.presences.eventId), eq(t.settlementSkips.attendee, t.presences.attendee)),
    )
    .where(
      and(
        eq(t.presences.attendee, pass),
        sql`${t.settlements.campaignId} is null`,
        sql`${t.presences.mode} >= ${t.campaigns.minProofMode}`,
        sql`${t.presences.at} between ${t.campaigns.startsAt} and ${t.campaigns.endsAt}`,
      ),
    )
    .orderBy(asc(t.campaigns.id), asc(t.presences.eventId));
  const now = Date.now();
  const out: Passport["pending"] = [];
  for (const row of rows) {
    if (row.endsAt.getTime() + SETTLE_GRACE_MS < now) continue;
    const reason = row.status === 8 ? "NeedsQieId" : row.status === 9 ? "PriceStale" : row.status === null || row.status === 10 || row.status === 12 ? "Pending" : null;
    if (reason) {
      out.push({ campaignId: row.campaignId.toString(), eventId: row.eventId.toString(), reason, deadline: new Date(row.endsAt.getTime() + SETTLE_GRACE_MS).toISOString() });
    }
  }
  return out;
}

/** Used by the cron route and the relayer: campaigns approved for an event that can still pay. */
export async function payingCampaignIds(db: Db, eventId: bigint): Promise<bigint[]> {
  const rows = await db
    .select({ id: t.campaignEvents.campaignId })
    .from(t.campaignEvents)
    .innerJoin(t.campaigns, eq(t.campaigns.id, t.campaignEvents.campaignId))
    .where(and(eq(t.campaignEvents.eventId, eventId), eq(t.campaignEvents.approved, true), gte(t.campaigns.endsAt, new Date(Date.now() - SETTLE_GRACE_MS))));
  return rows.map((r) => r.id);
}
