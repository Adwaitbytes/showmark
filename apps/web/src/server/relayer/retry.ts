import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { getAddress } from "viem";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { campaignEligibleFor, SETTLE_GRACE_MS } from "../payouts";
import type { SettleItem } from "./settle";

/** Give the normal check-in path this long to settle before the cron treats an item as missed. */
const MISSED_AFTER_MS = 2 * 60_000;

/**
 * Unpaid presences worth another settleBatch attempt: never attempted (the relayer could not send the settlement),
 * waiting on the oracle, the budget or a pause, or waiting on a QIE ID that the linked wallet now holds.
 * Skips that can never pay (caps, window, mode) are left alone so the cron does not burn gas on them.
 */
export async function retryableSettlements(db: Db, limit: number, now = Date.now()): Promise<SettleItem[]> {
  const rows = await db
    .select({ campaignId: t.campaigns.id, eventId: t.presences.eventId, attendee: t.presences.attendee })
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
    .leftJoin(t.links, eq(t.links.pass, t.presences.attendee))
    .leftJoin(t.profiles, eq(t.profiles.address, t.links.wallet))
    .where(
      and(
        sql`${t.settlements.campaignId} is null`,
        sql`${t.presences.mode} >= ${t.campaigns.minProofMode}`,
        sql`${t.presences.at} between ${t.campaigns.startsAt} and ${t.campaigns.endsAt}`,
        gte(t.campaigns.endsAt, new Date(now - SETTLE_GRACE_MS)),
        lt(t.presences.at, new Date(now - MISSED_AFTER_MS)),
        sql`(
          ${t.settlementSkips.status} is null
          or ${t.settlementSkips.status} in (9, 10, 12)
          or (${t.settlementSkips.status} = 8 and ${t.campaigns.requireQieId} and ${t.profiles.holdsQieId} is true)
        )`,
      ),
    )
    .orderBy(asc(t.presences.at))
    .limit(limit);
  return rows.map((r) => ({ campaignId: r.campaignId, eventId: r.eventId, attendee: getAddress(r.attendee) }));
}
