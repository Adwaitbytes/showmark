import "server-only";

import { and, asc, count, countDistinct, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getAddress, isAddress, isAddressEqual, zeroAddress } from "viem";
import type {
  Address,
  CampaignDetail,
  CampaignPaying,
  CampaignSummary,
  EventDetail,
  EventSummary,
  Hex,
  Passport,
  Settlement,
  Stamp,
  Traction,
} from "@/lib/api/types";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import { chainContext, contractsDeployed, type ChainContext } from "./chain";
import { getDatabase, type Db } from "./db/client";
import * as t from "./db/schema";
import { AppError, READ_ERRORS } from "./errors";
import { ensureFresh } from "./indexer/sync";
import { cacheStore } from "./kv";
import { log } from "./log";
import { attendeeShare, campaignEligibleFor, pendingFor, SETTLE_GRACE_MS } from "./payouts";
import { chainLatestDay, type ChainDay } from "./qie/blockscout";
import { addressOf, holdsQieId, looksLikeName, nameOf } from "./qie/names";
import { qieUsdPrice } from "./qie/price";
import { chainSlow, withTimeout } from "./timeout";

// Server components call these directly. Client components use the matching /api/* routes, which call the same
// functions. Every function returns real data from the indexer, or a real empty result when the contracts are not
// deployed yet. Anything that cannot be answered throws `AppError`, whose `copy` is safe to show to people.
// Money that can still move (claimable balances, streaks, quotes in USD) is read from the chain, not the index.

export interface EventFilter {
  /** Only events created by this organizer address. */
  organizer?: Address;
  /** Only events that have not ended yet, soonest first. Otherwise newest first. */
  upcoming?: boolean;
  /** Page size, 1 to 100. Defaults to 50. */
  limit?: number;
  offset?: number;
}

export interface CampaignFilter {
  /** Only campaigns created by this sponsor address. */
  sponsor?: Address;
  /** Page size, 1 to 100. Defaults to 50. */
  limit?: number;
  offset?: number;
}

/** Check-in opens this long before an event starts and closes this long after it ends. */
const CHECK_IN_MARGIN_MS = 60 * 60_000;
/** CampaignVault REVIEW_PERIOD: sponsors may challenge for this long after settlement closes. */
const REVIEW_PERIOD_MS = 7 * 24 * 60 * 60_000;
const RECENT_CHECK_INS = 20;
const CAMPAIGN_SETTLEMENTS = 200;
const TRACTION_DAYS = 30;

type TokenSymbol = "QIE" | "QUSDC";

const checksum = (lower: string): Address => getAddress(lower);
const iso = (d: Date) => d.toISOString();
const asMode = (mode: number): 1 | 2 => (mode === 2 ? 2 : 1);
const asHex = (value: string): Hex => value as Hex;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function parseId(id: string | bigint): bigint {
  if (typeof id === "bigint") {
    if (id < 0n) throw new AppError(400, READ_ERRORS.invalidId);
    return id;
  }
  if (!/^[0-9]{1,30}$/.test(id)) throw new AppError(400, READ_ERRORS.invalidId);
  return BigInt(id);
}

function tokenSymbol(ctx: ChainContext, token: string): TokenSymbol | null {
  if (token === zeroAddress) return "QIE";
  if (ctx.qusdc !== zeroAddress && isAddressEqual(checksum(token), ctx.qusdc)) return "QUSDC";
  return null;
}

interface Ready {
  ctx: ChainContext;
  db: Db;
}

/** Null when nothing is deployed on this network (real empty state). Otherwise brings the index up to date. */
async function ready(): Promise<Ready | null> {
  const ctx = chainContext();
  if (!contractsDeployed(ctx)) return null;
  const { db } = getDatabase();
  await ensureFresh();
  return { ctx, db };
}

// ---------------------------------------------------------------------------------------------- events

const eventColumns = {
  id: t.events.id,
  organizer: t.events.organizer,
  organizerName: t.profiles.qieName,
  startsAt: t.events.startsAt,
  endsAt: t.events.endsAt,
  capacity: t.events.capacity,
  checkedIn: t.events.checkedIn,
  maxPassAge: t.events.maxPassAge,
  seriesId: t.events.seriesId,
  seriesIndex: t.events.seriesIndex,
  name: t.events.name,
  venue: t.events.venue,
  city: t.events.city,
  description: t.events.description,
  url: t.events.url,
  createdTx: t.events.createdTx,
};

type EventRow = {
  id: bigint;
  organizer: string;
  organizerName: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  checkedIn: number;
  maxPassAge: number;
  seriesId: bigint;
  seriesIndex: number;
  name: string;
  venue: string;
  city: string;
  description: string;
  url: string | null;
  createdTx: string;
};

function toEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id.toString(),
    organizer: checksum(row.organizer),
    organizerName: row.organizerName,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    capacity: row.capacity,
    checkedIn: row.checkedIn,
    maxPassAge: row.maxPassAge,
    seriesId: row.seriesId.toString(),
    seriesIndex: row.seriesIndex,
    metadata: {
      v: 1,
      name: row.name,
      venue: row.venue,
      city: row.city,
      description: row.description,
      ...(row.url ? { url: row.url } : {}),
    },
    createdTx: asHex(row.createdTx),
  };
}

function selectEvents(db: Db) {
  return db.select(eventColumns).from(t.events).leftJoin(t.profiles, eq(t.profiles.address, t.events.organizer));
}

async function listEventsImpl(filter: EventFilter = {}): Promise<EventSummary[]> {
  const r = await ready();
  if (!r) return [];
  const conditions: SQL[] = [];
  if (filter.organizer) conditions.push(eq(t.events.organizer, filter.organizer.toLowerCase()));
  if (filter.upcoming) conditions.push(gte(t.events.endsAt, new Date()));
  const rows = await selectEvents(r.db)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(filter.upcoming ? asc(t.events.startsAt) : desc(t.events.id))
    .limit(clampLimit(filter.limit))
    .offset(Math.max(0, filter.offset ?? 0));
  return rows.map(toEventSummary);
}

// Remaining escrow per campaign: deposits minus gross payouts minus refunds, all from vault logs.
function campaignTotals(db: Db) {
  const funded = db
    .select({ campaignId: t.fundings.campaignId, amount: sql<string>`sum(${t.fundings.amount})`.as("funded_amount") })
    .from(t.fundings)
    .groupBy(t.fundings.campaignId)
    .as("funded");
  const settled = db
    .select({
      campaignId: t.settlements.campaignId,
      amount: sql<string>`sum(${t.settlements.gross})`.as("settled_amount"),
      n: sql<number>`count(*)::int`.as("settled_count"),
    })
    .from(t.settlements)
    .groupBy(t.settlements.campaignId)
    .as("settled");
  const refunded = db
    .select({ campaignId: t.refunds.campaignId, amount: sql<string>`sum(${t.refunds.amount})`.as("refunded_amount") })
    .from(t.refunds)
    .groupBy(t.refunds.campaignId)
    .as("refunded");
  return { funded, settled, refunded };
}

async function getEventImpl(id: string | bigint): Promise<EventDetail | null> {
  const eventId = parseId(id);
  const r = await ready();
  if (!r) return null;
  const { db, ctx } = r;
  const [row] = await selectEvents(db).where(eq(t.events.id, eventId)).limit(1);
  if (!row) return null;
  const summary = toEventSummary(row);

  const { funded, settled, refunded } = campaignTotals(db);
  const margin = CHECK_IN_MARGIN_MS;
  const campaignRows = await db
    .select({
      id: t.campaigns.id,
      name: t.campaigns.name,
      sponsorName: t.campaigns.sponsorName,
      token: t.campaigns.token,
      pricing: t.campaigns.pricing,
      amountPerPresence: t.campaigns.amountPerPresence,
      attendeeShareBps: t.campaigns.attendeeShareBps,
      feeBps: t.campaigns.feeBps,
      requireQieId: t.campaigns.requireQieId,
      minProofMode: t.campaigns.minProofMode,
      funded: funded.amount,
      settled: settled.amount,
      refunded: refunded.amount,
    })
    .from(t.campaigns)
    .leftJoin(funded, eq(funded.campaignId, t.campaigns.id))
    .leftJoin(settled, eq(settled.campaignId, t.campaigns.id))
    .leftJoin(refunded, eq(refunded.campaignId, t.campaigns.id))
    .where(
      and(
        campaignEligibleFor(eventId, row.organizer),
        gte(t.campaigns.endsAt, new Date(row.startsAt.getTime() - margin)),
        sql`${t.campaigns.startsAt} <= ${new Date(row.endsAt.getTime() + margin)}`,
      ),
    )
    .orderBy(asc(t.campaigns.id));

  // USD-priced campaigns are quoted live, all at once under the read deadline.
  const quotes = await Promise.all(campaignRows.map((c) => (c.pricing === 1 ? quoteGross(ctx, c.id) : Promise.resolve(c.amountPerPresence))));
  const campaigns: CampaignPaying[] = [];
  for (const [i, c] of campaignRows.entries()) {
    const symbol = tokenSymbol(ctx, c.token);
    if (!symbol) {
      log.warn("queries.unsupported_token", { campaignId: c.id, token: c.token });
      continue;
    }
    const balance = BigInt(c.funded ?? "0") - BigInt(c.settled ?? "0") - BigInt(c.refunded ?? "0");
    if (balance <= 0n) continue;
    const gross = quotes[i];
    if (gross === null) continue;
    campaigns.push({
      id: c.id.toString(),
      name: c.name,
      sponsorName: c.sponsorName,
      token: checksum(c.token),
      tokenSymbol: symbol,
      attendeeAmount: attendeeShare(gross, c.feeBps, c.attendeeShareBps).toString(),
      requireQieId: c.requireQieId,
      minProofMode: asMode(c.minProofMode),
    });
  }

  const recent = await db
    .select({ attendee: t.presences.attendee, at: t.presences.at, tx: t.presences.tx, mode: t.presences.mode, name: t.profiles.qieName })
    .from(t.presences)
    .leftJoin(t.links, eq(t.links.pass, t.presences.attendee))
    .leftJoin(t.profiles, eq(t.profiles.address, t.links.wallet))
    .where(eq(t.presences.eventId, eventId))
    .orderBy(desc(t.presences.block), desc(t.presences.attendee))
    .limit(RECENT_CHECK_INS);

  return {
    ...summary,
    campaigns,
    recentCheckIns: recent.map((p) => ({ attendee: checksum(p.attendee), name: p.name, at: iso(p.at), tx: asHex(p.tx), mode: asMode(p.mode) })),
  };
}

/**
 * What one presence pays right now, in token base units, from the vault (USD campaigns depend on the oracle).
 * Null when the chain does not answer in time: the event page then lists the campaigns it can price.
 */
async function quoteGross(ctx: ChainContext, campaignId: bigint): Promise<bigint | null> {
  try {
    const [amount] = await withTimeout(ctx.client.readContract({ address: ctx.vault, abi: vaultAbi, functionName: "quote", args: [campaignId] }), "vault.quote");
    return amount;
  } catch (error) {
    log.warn("queries.quote_unavailable", { campaignId, error });
    return null;
  }
}

// -------------------------------------------------------------------------------------------- passport

async function getPassportImpl(addressOrName: string): Promise<Passport | null> {
  let address: Address;
  if (looksLikeName(addressOrName)) {
    const owner = await ownerOfName(addressOrName);
    if (!owner) return null;
    address = owner;
  } else if (isAddress(addressOrName, { strict: false })) {
    address = getAddress(addressOrName);
  } else {
    throw new AppError(400, READ_ERRORS.invalidAddress);
  }

  const r = await ready();
  const ctx = r?.ctx ?? chainContext();
  if (!r) {
    const [qieName, holds] = await Promise.all([nameOf(address).catch(() => null), holdsQieId(address).catch(() => false)]);
    return { pass: null, wallet: address, qieName, holdsQieId: holds, stamps: [], streaks: [], claimable: [], pending: [] };
  }
  const { db } = r;
  const lower = address.toLowerCase();

  const [link] = await db.select().from(t.links).where(or(eq(t.links.pass, lower), eq(t.links.wallet, lower))).limit(1);
  let pass: string | null;
  let wallet: string | null;
  if (link) {
    pass = link.pass;
    wallet = link.wallet;
  } else {
    const [{ n }] = await db.select({ n: count() }).from(t.presences).where(eq(t.presences.attendee, lower));
    pass = n > 0 ? lower : null;
    wallet = n > 0 ? null : lower;
  }

  const stampRows = pass
    ? await db
        .select({
          eventId: t.presences.eventId,
          eventName: t.events.name,
          city: t.events.city,
          seriesId: t.events.seriesId,
          at: t.presences.at,
          mode: t.presences.mode,
          tx: t.presences.tx,
          streak: t.presences.streak,
        })
        .from(t.presences)
        .leftJoin(t.events, eq(t.events.id, t.presences.eventId))
        .where(eq(t.presences.attendee, pass))
        .orderBy(desc(t.presences.block))
    : [];
  const stamps: Stamp[] = stampRows.map((s) => ({
    eventId: s.eventId.toString(),
    eventName: s.eventName ?? `Event ${s.eventId}`,
    city: s.city ?? "",
    at: iso(s.at),
    mode: asMode(s.mode),
    tx: asHex(s.tx),
    streak: s.streak,
  }));

  const passAddress = pass ? checksum(pass) : null;
  const walletAddress = wallet ? checksum(wallet) : null;
  const holder = passAddress ?? address;

  const seriesIds = [...new Set(stampRows.map((s) => s.seriesId).filter((id): id is bigint => id !== null && id !== 0n))];
  const seriesNames = seriesIds.length ? await db.select({ id: t.series.id, name: t.series.name }).from(t.series).where(inArray(t.series.id, seriesIds)) : [];
  const tokens = [zeroAddress, ...(ctx.qusdc !== zeroAddress ? [ctx.qusdc] : [])];

  // Live values from the chain, with one deadline for the balances and one for the name, run side by side. When
  // the chain is slow the indexed equivalents are shown instead (they trail the chain by at most a few blocks), so
  // the passport always renders.
  const balances = withTimeout(
    Promise.all([
      Promise.all(
        seriesIds.map((id) =>
          passAddress
            ? ctx.client.readContract({ address: ctx.registry, abi: registryAbi, functionName: "streakOf", args: [id, passAddress] })
            : Promise.resolve([0, 0] as const),
        ),
      ),
      Promise.all(tokens.map((token) => ctx.client.readContract({ address: ctx.vault, abi: vaultAbi, functionName: "claimable", args: [token, holder] }))),
    ]),
    "passport.balances",
  ).catch(async (error: unknown) => {
    log.warn("queries.passport_indexed_fallback", { address: holder, error });
    const streaks = pass ? await indexedStreaks(db, pass, seriesIds) : seriesIds.map(() => [0, 0] as const);
    return [streaks, await indexedClaimable(db, holder.toLowerCase(), tokens)] as const;
  });
  const nameHolder = walletAddress ?? address;
  const identity = withTimeout(
    Promise.all([nameOf(nameHolder), walletAddress ? holdsQieId(walletAddress) : Promise.resolve(false)]),
    "passport.name",
  ).catch(async (error: unknown) => {
    log.warn("queries.name_fallback", { address: nameHolder, error });
    const [profile] = await db.select().from(t.profiles).where(eq(t.profiles.address, nameHolder.toLowerCase())).limit(1);
    return [profile?.qieName ?? null, walletAddress ? (profile?.holdsQieId ?? false) : false] as const;
  });
  const [[streakValues, claimableValues], [qieName, holds]] = await Promise.all([balances, identity]);

  return {
    pass: passAddress,
    wallet: walletAddress,
    qieName,
    holdsQieId: holds,
    stamps,
    streaks: seriesIds.map((id, i) => ({
      seriesId: id.toString(),
      seriesName: seriesNames.find((s) => s.id === id)?.name ?? `Series ${id}`,
      current: streakValues[i][0],
      best: streakValues[i][1],
    })),
    claimable: tokens.map((token, i) => ({ token, symbol: token === zeroAddress ? "QIE" : "QUSDC", amount: claimableValues[i].toString() })),
    pending: pass ? await pendingFor(db, pass) : [],
  };
}

/** A name's owner from the registry; if the chain is slow, from indexed profiles; otherwise a typed chain_slow error. */
async function ownerOfName(name: string): Promise<Address | null> {
  try {
    return await addressOf(name);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 503) throw error;
    const fqn = name.trim().toLowerCase().endsWith(".qie") ? name.trim().toLowerCase() : `${name.trim().toLowerCase()}.qie`;
    const ctx = chainContext();
    if (contractsDeployed(ctx)) {
      const [row] = await getDatabase().db.select({ address: t.profiles.address }).from(t.profiles).where(eq(t.profiles.qieName, fqn)).limit(1);
      if (row) return checksum(row.address);
    }
    throw chainSlow(error);
  }
}

/** Streaks from indexed presences: the streak recorded at the latest attended index, and the best seen. */
async function indexedStreaks(db: Db, pass: string, seriesIds: bigint[]): Promise<(readonly [number, number])[]> {
  const rows = await db
    .select({ seriesId: t.events.seriesId, seriesIndex: t.events.seriesIndex, streak: t.presences.streak })
    .from(t.presences)
    .innerJoin(t.events, eq(t.events.id, t.presences.eventId))
    .where(and(eq(t.presences.attendee, pass), inArray(t.events.seriesId, seriesIds.length ? seriesIds : [0n])));
  return seriesIds.map((id) => {
    const mine = rows.filter((r) => r.seriesId === id).sort((a, b) => b.seriesIndex - a.seriesIndex);
    return [mine[0]?.streak ?? 0, Math.max(0, ...mine.map((r) => r.streak))] as const;
  });
}

/** Claimable per token from vault logs: credited as attendee and as organizer, minus withdrawals. */
async function indexedClaimable(db: Db, account: string, tokens: Address[]): Promise<bigint[]> {
  const credited = await db
    .select({
      token: t.campaigns.token,
      amount: sql<string>`sum(case when ${t.settlements.attendee} = ${account} then ${t.settlements.toAttendee} else 0 end + case when ${t.settlements.organizer} = ${account} then ${t.settlements.toOrganizer} else 0 end)`,
    })
    .from(t.settlements)
    .innerJoin(t.campaigns, eq(t.campaigns.id, t.settlements.campaignId))
    .where(or(eq(t.settlements.attendee, account), eq(t.settlements.organizer, account)))
    .groupBy(t.campaigns.token);
  const withdrawn = await db
    .select({ token: t.withdrawals.token, amount: sql<string>`sum(${t.withdrawals.amount})` })
    .from(t.withdrawals)
    .where(eq(t.withdrawals.account, account))
    .groupBy(t.withdrawals.token);
  return tokens.map((token) => {
    const key = token.toLowerCase();
    const owed = BigInt(credited.find((c) => c.token === key)?.amount ?? "0") - BigInt(withdrawn.find((w) => w.token === key)?.amount ?? "0");
    return owed > 0n ? owed : 0n;
  });
}

// ------------------------------------------------------------------------------------------- campaigns

function campaignStatus(startsAt: Date, endsAt: Date, balance: bigint, refundedAny: boolean, now = Date.now()): CampaignSummary["status"] {
  if (refundedAny && balance === 0n) return "refunded";
  if (now < startsAt.getTime()) return "scheduled";
  if (now <= endsAt.getTime()) return "live";
  if (now > endsAt.getTime() + SETTLE_GRACE_MS && balance > 0n) return "refundable";
  return "ended";
}

async function selectCampaigns(r: Ready, where: SQL | undefined, limit: number, offset: number): Promise<CampaignSummary[]> {
  const { db, ctx } = r;
  const { funded, settled, refunded } = campaignTotals(db);
  const rows = await db
    .select({
      c: t.campaigns,
      funded: funded.amount,
      settled: settled.amount,
      settledCount: settled.n,
      refunded: refunded.amount,
    })
    .from(t.campaigns)
    .leftJoin(funded, eq(funded.campaignId, t.campaigns.id))
    .leftJoin(settled, eq(settled.campaignId, t.campaigns.id))
    .leftJoin(refunded, eq(refunded.campaignId, t.campaigns.id))
    .where(where)
    .orderBy(desc(t.campaigns.id))
    .limit(limit)
    .offset(offset);
  const out: CampaignSummary[] = [];
  for (const row of rows) {
    const c = row.c;
    const symbol = tokenSymbol(ctx, c.token);
    if (!symbol) {
      log.warn("queries.unsupported_token", { campaignId: c.id, token: c.token });
      continue;
    }
    const fundedAmount = BigInt(row.funded ?? "0");
    const settledAmount = BigInt(row.settled ?? "0");
    const refundedAmount = BigInt(row.refunded ?? "0");
    const remaining = fundedAmount - settledAmount - refundedAmount;
    const balance = remaining > 0n ? remaining : 0n;
    out.push({
      id: c.id.toString(),
      sponsor: checksum(c.sponsor),
      sponsorName: c.sponsorName,
      name: c.name,
      description: c.description,
      token: checksum(c.token),
      tokenSymbol: symbol,
      pricing: c.pricing === 1 ? 1 : 0,
      amountPerPresence: c.amountPerPresence.toString(),
      attendeeShareBps: c.attendeeShareBps,
      feeBps: c.feeBps,
      minProofMode: asMode(c.minProofMode),
      requireQieId: c.requireQieId,
      startsAt: iso(c.startsAt),
      endsAt: iso(c.endsAt),
      balance: balance.toString(),
      funded: fundedAmount.toString(),
      settledCount: row.settledCount ?? 0,
      settledAmount: settledAmount.toString(),
      teamFunded: c.teamFunded,
      status: campaignStatus(c.startsAt, c.endsAt, balance, refundedAmount > 0n),
      maxPerEvent: c.maxPerEvent,
      maxTotal: c.maxTotal,
      openToBonded: c.openToBonded,
      minBond: c.minBond.toString(),
      // vault.challengeDeadline is endsAt + SETTLE_GRACE + REVIEW_PERIOD; endsAt is indexed (CampaignClosed included).
      challengeDeadline: c.openToBonded ? new Date(c.endsAt.getTime() + SETTLE_GRACE_MS + REVIEW_PERIOD_MS).toISOString() : null,
    });
  }
  return out;
}

async function listCampaignsImpl(filter: CampaignFilter = {}): Promise<CampaignSummary[]> {
  const r = await ready();
  if (!r) return [];
  const where = filter.sponsor ? eq(t.campaigns.sponsor, filter.sponsor.toLowerCase()) : undefined;
  return selectCampaigns(r, where, clampLimit(filter.limit), Math.max(0, filter.offset ?? 0));
}

export interface CampaignDetailOptions {
  /** Settlements to include, newest first. Defaults to 200; the report export passes no limit. */
  settlementLimit?: number | null;
}

/** Returns null when no campaign with this id exists. */
async function getCampaignImpl(id: string | bigint, options: CampaignDetailOptions = {}): Promise<CampaignDetail | null> {
  const campaignId = parseId(id);
  const r = await ready();
  if (!r) return null;
  const { db } = r;
  const [summary] = await selectCampaigns(r, eq(t.campaigns.id, campaignId), 1, 0);
  if (!summary) return null;

  const settledPerEvent = db
    .select({ eventId: t.settlements.eventId, n: sql<number>`count(*)::int`.as("n") })
    .from(t.settlements)
    .where(eq(t.settlements.campaignId, campaignId))
    .groupBy(t.settlements.eventId)
    .as("per_event");
  const eventRows = await db
    .select({ ...eventColumns, approved: t.campaignEvents.approved, settled: settledPerEvent.n })
    .from(t.campaignEvents)
    .innerJoin(t.events, eq(t.events.id, t.campaignEvents.eventId))
    .leftJoin(t.profiles, eq(t.profiles.address, t.events.organizer))
    .leftJoin(settledPerEvent, eq(settledPerEvent.eventId, t.events.id))
    .where(eq(t.campaignEvents.campaignId, campaignId))
    .orderBy(asc(t.events.startsAt));

  const limit = options.settlementLimit === undefined ? CAMPAIGN_SETTLEMENTS : options.settlementLimit;
  // Attendees are passes: their name is the name of the wallet they linked, if any.
  const attendeeProfile = alias(t.profiles, "attendee_profile");
  const organizerProfile = alias(t.profiles, "organizer_profile");
  const settlementQuery = db
    .select({ s: t.settlements, eventName: t.events.name, attendeeName: attendeeProfile.qieName, organizerName: organizerProfile.qieName })
    .from(t.settlements)
    .leftJoin(t.events, eq(t.events.id, t.settlements.eventId))
    .leftJoin(t.links, eq(t.links.pass, t.settlements.attendee))
    .leftJoin(attendeeProfile, eq(attendeeProfile.address, t.links.wallet))
    .leftJoin(organizerProfile, eq(organizerProfile.address, t.settlements.organizer))
    .where(eq(t.settlements.campaignId, campaignId))
    .orderBy(desc(t.settlements.block), asc(t.settlements.attendee));
  const settlementRows = limit === null ? await settlementQuery : await settlementQuery.limit(limit);

  const settlements: Settlement[] = settlementRows.map(({ s, eventName, attendeeName, organizerName }) => ({
    campaignId: s.campaignId.toString(),
    eventId: s.eventId.toString(),
    eventName: eventName ?? `Event ${s.eventId}`,
    attendee: checksum(s.attendee),
    attendeeName: attendeeName ?? null,
    organizer: checksum(s.organizer),
    organizerName: organizerName ?? null,
    gross: s.gross.toString(),
    toAttendee: s.toAttendee.toString(),
    toOrganizer: s.toOrganizer.toString(),
    fee: s.fee.toString(),
    at: iso(s.at),
    tx: asHex(s.tx),
  }));

  return {
    ...summary,
    events: eventRows.map((row) => ({ ...toEventSummary(row), approved: row.approved, settled: row.settled ?? 0 })),
    settlements,
  };
}

// -------------------------------------------------------------------------------------------- traction

const CHAIN_STATS_KEY = "traction:chain-day";
const CHAIN_STATS_MS = 5 * 60_000;
/** A chain day whose end is older than this is not shown. */
const CHAIN_DAY_MAX_AGE_MS = 36 * 60 * 60_000;
const DAY_MS = 86_400_000;

async function chainDay(chainId: number): Promise<ChainDay | null> {
  const kv = cacheStore();
  const key = `${CHAIN_STATS_KEY}:${chainId}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached === "" ? null : (JSON.parse(cached) as ChainDay);
  try {
    const value = await chainLatestDay();
    await kv.set(key, value === null ? "" : JSON.stringify(value), { px: CHAIN_STATS_MS });
    return value;
  } catch (error) {
    // The explorer stat is context, not a Showmark number: show "unknown" rather than fail the page.
    log.warn("traction.chain_stats_failed", { error });
    return null;
  }
}

async function getTractionImpl(): Promise<Traction> {
  const r = await ready();
  if (!r) return emptyTraction();
  const { db, ctx } = r;

  const attendeesWithPresence = db.selectDistinct({ attendee: t.presences.attendee }).from(t.presences);

  const [[presenceStats], [organizerStats], sponsorRows, settledRows, [walletStats], [linkStats], [repeatStats], [txStats], dailyCheckIns, dailySettlements] =
    await Promise.all([
      db.select({ attendees: countDistinct(t.presences.attendee), events: countDistinct(t.presences.eventId) }).from(t.presences),
      db
        .select({ organizers: countDistinct(t.events.organizer) })
        .from(t.events)
        .where(sql`exists (select 1 from ${t.presences} where ${t.presences.eventId} = ${t.events.id})`),
      db
        .select({ teamFunded: t.campaigns.teamFunded, sponsors: countDistinct(t.campaigns.sponsor) })
        .from(t.campaigns)
        .where(sql`exists (select 1 from ${t.fundings} where ${t.fundings.campaignId} = ${t.campaigns.id})`)
        .groupBy(t.campaigns.teamFunded),
      db
        .select({ token: t.campaigns.token, teamFunded: t.campaigns.teamFunded, gross: sql<string>`sum(${t.settlements.gross})` })
        .from(t.settlements)
        .innerJoin(t.campaigns, eq(t.campaigns.id, t.settlements.campaignId))
        .groupBy(t.campaigns.token, t.campaigns.teamFunded),
      db.select({ n: count() }).from(t.profiles).where(eq(t.profiles.firstSeenViaShowmark, true)),
      db
        .select({ linked: count(), withQieId: sql<number>`count(*) filter (where ${t.profiles.holdsQieId})::int` })
        .from(t.links)
        .leftJoin(t.profiles, eq(t.profiles.address, t.links.wallet))
        .where(inArray(t.links.pass, attendeesWithPresence)),
      db
        .select({ n: count() })
        .from(
          db
            .select({ attendee: t.presences.attendee })
            .from(t.presences)
            .groupBy(t.presences.attendee)
            .having(sql`count(*) >= 2`)
            .as("repeat"),
        ),
      db.select({ n: count() }).from(t.transactions),
      db
        .select({ day: sql<string>`to_char(${t.presences.at} at time zone 'utc', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
        .from(t.presences)
        .where(gte(t.presences.at, new Date(Date.now() - TRACTION_DAYS * 86_400_000)))
        .groupBy(sql`1`),
      db
        .select({ day: sql<string>`to_char(${t.settlements.at} at time zone 'utc', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
        .from(t.settlements)
        .where(gte(t.settlements.at, new Date(Date.now() - TRACTION_DAYS * 86_400_000)))
        .groupBy(sql`1`),
    ]);

  const [price, chainDailyStats] = await Promise.all([
    qieUsdPrice(ctx).catch((error: unknown) => {
      // The USD figure is shown with its own "price unavailable" state; the counts above stand on their own.
      log.warn("traction.price_unavailable", { error });
      return null;
    }),
    chainDay(ctx.chainId),
  ]);

  // Share of the chain's day: Showmark's transactions in exactly the explorer's window (its latest complete UTC
  // day). Not shown when the explorer figure is missing, stale, or smaller than ours (which would be a bad count).
  let chainDaily: number | null = null;
  let shareOfChainDaily: number | null = null;
  if (chainDailyStats) {
    const start = new Date(`${chainDailyStats.date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + DAY_MS);
    if (Date.now() - end.getTime() <= CHAIN_DAY_MAX_AGE_MS) {
      const [{ n: ours }] = await db
        .select({ n: count() })
        .from(t.transactions)
        .where(and(gte(t.transactions.at, start), sql`${t.transactions.at} < ${end}`));
      chainDaily = chainDailyStats.transactions;
      shareOfChainDaily = chainDaily > 0 && chainDaily >= ours ? ours / chainDaily : null;
      if (chainDaily < ours) log.warn("traction.chain_day_below_showmark", { date: chainDailyStats.date, chain: chainDaily, showmark: ours });
    }
  }

  const settledByToken = new Map<string, { symbol: TokenSymbol; teamFunded: bigint; external: bigint }>();
  const usd = { teamFunded: 0, external: 0 };
  for (const row of settledRows) {
    const symbol = tokenSymbol(ctx, row.token);
    if (!symbol) continue;
    const entry = settledByToken.get(row.token) ?? { symbol, teamFunded: 0n, external: 0n };
    const gross = BigInt(row.gross ?? "0");
    if (row.teamFunded) entry.teamFunded += gross;
    else entry.external += gross;
    settledByToken.set(row.token, entry);
    const value = symbol === "QUSDC" ? Number(gross) / 1e6 : price ? (Number(gross) / 1e18) * price.usd : 0;
    if (row.teamFunded) usd.teamFunded += value;
    else usd.external += value;
  }

  const days = new Map<string, { checkIns: number; settlements: number }>();
  for (let i = TRACTION_DAYS - 1; i >= 0; i--) days.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { checkIns: 0, settlements: 0 });
  for (const d of dailyCheckIns) {
    const day = days.get(d.day);
    if (day) day.checkIns = d.n;
  }
  for (const d of dailySettlements) {
    const day = days.get(d.day);
    if (day) day.settlements = d.n;
  }

  const verifiedAttendees = presenceStats?.attendees ?? 0;
  const passesLinked = linkStats?.linked ?? 0;
  return {
    updatedAt: new Date().toISOString(),
    verifiedAttendees,
    eventsWithCheckIns: presenceStats?.events ?? 0,
    organizers: organizerStats?.organizers ?? 0,
    sponsors: {
      teamFunded: sponsorRows.find((s) => s.teamFunded)?.sponsors ?? 0,
      external: sponsorRows.find((s) => !s.teamFunded)?.sponsors ?? 0,
    },
    settled: [...settledByToken].map(([token, v]) => ({ token: checksum(token), symbol: v.symbol, teamFunded: v.teamFunded.toString(), external: v.external.toString() })),
    settledUsd: { teamFunded: usd.teamFunded, external: usd.external, price: price?.usd ?? 0, priceUpdatedAt: (price?.updatedAt ?? new Date(0)).toISOString() },
    newWalletsViaShowmark: walletStats?.n ?? 0,
    passesLinked,
    conversionRate: verifiedAttendees > 0 ? passesLinked / verifiedAttendees : 0,
    attendeesWithQieId: linkStats?.withQieId ?? 0,
    repeatAttendees: repeatStats?.n ?? 0,
    showmarkTransactions: txStats?.n ?? 0,
    chainDailyTransactions: chainDaily,
    shareOfChainDaily,
    daily: [...days].map(([date, v]) => ({ date, ...v })),
  };
}

function emptyTraction(): Traction {
  return {
    updatedAt: new Date().toISOString(),
    verifiedAttendees: 0,
    eventsWithCheckIns: 0,
    organizers: 0,
    sponsors: { teamFunded: 0, external: 0 },
    settled: [],
    settledUsd: { teamFunded: 0, external: 0, price: 0, priceUpdatedAt: new Date(0).toISOString() },
    newWalletsViaShowmark: 0,
    passesLinked: 0,
    conversionRate: 0,
    attendeesWithQieId: 0,
    repeatAttendees: 0,
    showmarkTransactions: 0,
    chainDailyTransactions: null,
    shareOfChainDaily: null,
    daily: [],
  };
}

// ------------------------------------------------------------------------------------------ deadlines

const DATABASE_SLOW = {
  code: "database_slow",
  message: "Showmark's records are taking longer than usual to load.",
  action: "Try again in a few seconds.",
} as const;

function isDeadline(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  }
  return false;
}

/** A query that hit the database or Redis deadline answers with typed copy instead of an unexplained failure. */
async function guarded<T>(route: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AppError) && isDeadline(error)) {
      log.warn("queries.deadline", { route, error });
      throw new AppError(503, DATABASE_SLOW, { cause: error });
    }
    throw error;
  }
}

export const listEvents = (filter: EventFilter = {}): Promise<EventSummary[]> => guarded("listEvents", () => listEventsImpl(filter));
/** Returns null when no event with this id exists. */
export const getEvent = (id: string | bigint): Promise<EventDetail | null> => guarded("getEvent", () => getEventImpl(id));
/** Accepts an address or a QIE ID name such as `alice.qie`. Null when the name does not resolve. */
export const getPassport = (addressOrName: string): Promise<Passport | null> => guarded("getPassport", () => getPassportImpl(addressOrName));
export const listCampaigns = (filter: CampaignFilter = {}): Promise<CampaignSummary[]> => guarded("listCampaigns", () => listCampaignsImpl(filter));
/** Returns null when no campaign with this id exists. */
export const getCampaign = (id: string | bigint, options: CampaignDetailOptions = {}): Promise<CampaignDetail | null> =>
  guarded("getCampaign", () => getCampaignImpl(id, options));
export const getTraction = (): Promise<Traction> => guarded("getTraction", () => getTractionImpl());
