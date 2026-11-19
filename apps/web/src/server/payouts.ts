import { and, asc, eq, gte, sql, type SQL, type SQLWrapper } from "drizzle-orm";
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
 * A campaign pays for an event when the sponsor approved the event, or when the campaign is open to bonded
 * organizers and the event's organizer opted in (the vault then also checks the organizer's bond room).
 */
export function campaignEligibleFor(eventId: SQLWrapper | bigint, organizer: SQLWrapper | string): SQL {
  return sql`(exists (select 1 from ${t.campaignEvents} where ${t.campaignEvents.campaignId} = ${t.campaigns.id} and ${t.campaignEvents.eventId} = ${eventId} and ${t.campaignEvents.approved})
    or (${t.campaigns.openToBonded} and exists (select 1 from ${t.campaignOptIns} where ${t.campaignOptIns.campaignId} = ${t.campaigns.id} and ${t.campaignOptIns.organizer} = ${organizer} and ${t.campaignOptIns.optedIn})))`;
}

/**
 * Payouts this pass is still owed: an eligible campaign whose rules the presence meets, with no settlement yet.
 * The latest skip status says why. Skips that can never succeed (caps reached, window passed) are not pending.
 */
export async function pendingFor(db: Db, pass: string): Promise<Passport["pending"]> {
  const rows = await db
    .select({ campaignId: t.campaigns.id, eventId: t.presences.eventId, status: t.settlementSkips.status, endsAt: t.campaigns.endsAt })
    .from(t.presences)
    .innerJoin(t.events, eq(t.events.id, t.presences.eventId))
    .innerJoin(t.campaigns, campaignEligibleFor(t.presences.eventId, t.events.organizer))
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

/** Campaigns that can still pay for an event: approved for it, or open with the organizer opted in (per the index). */
export async function payingCampaignIds(db: Db, eventId: bigint): Promise<bigint[]> {
  const [event] = await db.select({ organizer: t.events.organizer }).from(t.events).where(eq(t.events.id, eventId)).limit(1);
  const rows = await db
    .select({ id: t.campaigns.id })
    .from(t.campaigns)
    .where(and(campaignEligibleFor(eventId, event?.organizer ?? ""), gte(t.campaigns.endsAt, new Date(Date.now() - SETTLE_GRACE_MS))))
    .orderBy(asc(t.campaigns.id));
  return rows.map((r) => r.id);
}

/** Open-to-bonded campaigns that can still pay, for the relayer's live opt-in check when the index lags. */
export async function openCampaignIds(db: Db): Promise<bigint[]> {
  const rows = await db
    .select({ id: t.campaigns.id })
    .from(t.campaigns)
    .where(and(eq(t.campaigns.openToBonded, true), gte(t.campaigns.endsAt, new Date(Date.now() - SETTLE_GRACE_MS))));
  return rows.map((r) => r.id);
}
