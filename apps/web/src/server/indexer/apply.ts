import { eq, inArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Db, Statement } from "../db/client";
import * as t from "../db/schema";
import type { ShowmarkLog } from "./decode";
import { parseCampaignMetadata, parseEventMetadata, parseSeriesName } from "./metadata";

// Turns decoded logs into idempotent SQL. Append-only facts (presences, payouts, fundings) use
// ON CONFLICT DO NOTHING; mutable rows (event metadata, approvals, closes) are applied in log order.
// Everything for one block range runs in a single batch together with the sync_state update.

export interface ApplyContext {
  teamAddresses: ReadonlySet<Address>;
}

const INSERT_CHUNK = 500;
const lower = (a: string) => a.toLowerCase();
const fromSeconds = (s: bigint | number) => new Date(Number(s) * 1000);

function chunks<T>(items: T[], size = INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isTeam(ctx: ApplyContext, address: string): boolean {
  for (const team of ctx.teamAddresses) if (team.toLowerCase() === lower(address)) return true;
  return false;
}

export function blockTime(blockTimes: ReadonlyMap<bigint, Date>, block: bigint): Date {
  const at = blockTimes.get(block);
  if (!at) throw new Error(`Missing timestamp for block ${block}`);
  return at;
}

export function buildStatements(db: Db, logs: ShowmarkLog[], blockTimes: ReadonlyMap<bigint, Date>, ctx: ApplyContext): Statement[] {
  const ordered: Statement[] = [];
  const presences: (typeof t.presences.$inferInsert)[] = [];
  const links: (typeof t.links.$inferInsert)[] = [];
  const fundings: (typeof t.fundings.$inferInsert)[] = [];
  const settlements: (typeof t.settlements.$inferInsert)[] = [];
  const refunds: (typeof t.refunds.$inferInsert)[] = [];
  const withdrawals: (typeof t.withdrawals.$inferInsert)[] = [];
  const skips = new Map<string, typeof t.settlementSkips.$inferInsert>();
  const txs = new Map<string, typeof t.transactions.$inferInsert>();
  const profiles = new Map<string, bigint>();
  const touchedEvents = new Set<bigint>();

  const seen = (address: string, block: bigint) => {
    const key = lower(address);
    const prev = profiles.get(key);
    if (prev === undefined || block < prev) profiles.set(key, block);
  };

  for (const log of logs) {
    const block = log.blockNumber;
    const tx = lower(log.transactionHash);
    const at = blockTime(blockTimes, block);
    if (!txs.has(tx)) txs.set(tx, { hash: tx, block, at });

    switch (log.eventName) {
      case "SeriesCreated": {
        const { seriesId, organizer, metadata } = log.args;
        seen(organizer, block);
        ordered.push(
          db
            .insert(t.series)
            .values({ id: seriesId, organizer: lower(organizer), name: parseSeriesName(metadata, seriesId), createdBlock: block, createdTx: tx })
            .onConflictDoNothing(),
        );
        break;
      }
      case "EventCreated": {
        const a = log.args;
        const m = parseEventMetadata(a.metadata, a.eventId);
        seen(a.organizer, block);
        touchedEvents.add(a.eventId);
        ordered.push(
          db
            .insert(t.events)
            .values({
              id: a.eventId,
              organizer: lower(a.organizer),
              startsAt: fromSeconds(a.startsAt),
              endsAt: fromSeconds(a.endsAt),
              capacity: a.capacity,
              checkedIn: 0,
              maxPassAge: a.maxPassAge,
              seriesId: a.seriesId,
              seriesIndex: a.seriesIndex,
              name: m.name,
              venue: m.venue,
              city: m.city,
              description: m.description,
              url: m.url,
              createdBlock: block,
              createdTx: tx,
            })
            .onConflictDoNothing(),
        );
        break;
      }
      case "EventMetadataUpdated": {
        const m = parseEventMetadata(log.args.metadata, log.args.eventId);
        ordered.push(
          db
            .update(t.events)
            .set({ name: m.name, venue: m.venue, city: m.city, description: m.description, url: m.url })
            .where(eq(t.events.id, log.args.eventId)),
        );
        break;
      }
      case "CapacityChanged":
        ordered.push(db.update(t.events).set({ capacity: log.args.capacity }).where(eq(t.events.id, log.args.eventId)));
        break;
      case "CheckedIn": {
        const a = log.args;
        touchedEvents.add(a.eventId);
        presences.push({
          eventId: a.eventId,
          attendee: lower(a.attendee),
          mode: a.mode,
          doorKey: lower(a.doorKey),
          doorTime: fromSeconds(a.doorTime),
          streak: a.streak,
          block,
          tx,
          at,
        });
        break;
      }
      case "WalletLinked":
        seen(log.args.wallet, block);
        links.push({ pass: lower(log.args.pass), wallet: lower(log.args.wallet), block, tx });
        break;
      case "CampaignCreated": {
        const a = log.args;
        const m = parseCampaignMetadata(a.metadata, a.campaignId);
        seen(a.sponsor, block);
        ordered.push(
          db
            .insert(t.campaigns)
            .values({
              id: a.campaignId,
              sponsor: lower(a.sponsor),
              token: lower(a.token),
              pricing: a.pricing,
              amountPerPresence: a.amountPerPresence,
              attendeeShareBps: a.attendeeShareBps,
              minProofMode: a.minProofMode,
              requireQieId: a.requireQieId,
              startsAt: fromSeconds(a.startsAt),
              endsAt: fromSeconds(a.endsAt),
              feeBps: a.feeBps,
              name: m.name,
              sponsorName: m.sponsorName,
              description: m.description,
              url: m.url,
              teamFunded: isTeam(ctx, a.sponsor),
              createdBlock: block,
              createdTx: tx,
            })
            .onConflictDoNothing(),
        );
        break;
      }
      case "CampaignFunded":
        fundings.push({ campaignId: log.args.campaignId, fromAddr: lower(log.args.from), amount: log.args.amount, block, tx, logIndex: log.logIndex });
        break;
      case "EventsApproved":
      case "EventsRevoked": {
        const approved = log.eventName === "EventsApproved";
        const ids = [...new Set(log.args.eventIds)];
        if (ids.length === 0) break;
        ordered.push(
          db
            .insert(t.campaignEvents)
            .values(ids.map((eventId) => ({ campaignId: log.args.campaignId, eventId, approved })))
            .onConflictDoUpdate({ target: [t.campaignEvents.campaignId, t.campaignEvents.eventId], set: { approved } }),
        );
        break;
      }
      case "CampaignClosed":
        ordered.push(db.update(t.campaigns).set({ endsAt: fromSeconds(log.args.endsAt) }).where(eq(t.campaigns.id, log.args.campaignId)));
        break;
      case "Settled": {
        const a = log.args;
        settlements.push({
          campaignId: a.campaignId,
          eventId: a.eventId,
          attendee: lower(a.attendee),
          organizer: lower(a.organizer),
          gross: a.gross,
          toAttendee: a.toAttendee,
          toOrganizer: a.toOrganizer,
          fee: a.fee,
          price: a.price,
          block,
          tx,
          at,
        });
        break;
      }
      case "SettlementSkipped": {
        const a = log.args;
        const key = `${a.campaignId}:${a.eventId}:${lower(a.attendee)}`;
        skips.set(key, { campaignId: a.campaignId, eventId: a.eventId, attendee: lower(a.attendee), status: a.status, block, tx });
        break;
      }
      case "Refunded":
        refunds.push({ campaignId: log.args.campaignId, sponsor: lower(log.args.sponsor), amount: log.args.amount, block, tx, logIndex: log.logIndex });
        break;
      case "Withdrawn":
        withdrawals.push({
          token: lower(log.args.token),
          account: lower(log.args.account),
          toAddr: lower(log.args.to),
          amount: log.args.amount,
          block,
          tx,
          logIndex: log.logIndex,
        });
        break;
      case "DoorKeyAuthorized":
      case "DoorKeyRevoked":
      case "CheckInRejected":
      case "FeeChanged":
      case "EIP712DomainChanged":
      case "OwnershipTransferStarted":
      case "OwnershipTransferred":
      case "Paused":
      case "Unpaused":
        // Counted as Showmark transactions; nothing else is stored.
        break;
      default: {
        const unhandled: never = log;
        throw new Error(`Unhandled Showmark event ${JSON.stringify(unhandled)}`);
      }
    }
  }

  const statements: Statement[] = [...ordered];
  for (const rows of chunks(presences)) statements.push(db.insert(t.presences).values(rows).onConflictDoNothing());
  for (const rows of chunks(links)) statements.push(db.insert(t.links).values(rows).onConflictDoNothing());
  for (const rows of chunks(fundings)) statements.push(db.insert(t.fundings).values(rows).onConflictDoNothing());
  for (const rows of chunks(settlements)) statements.push(db.insert(t.settlements).values(rows).onConflictDoNothing());
  for (const rows of chunks(refunds)) statements.push(db.insert(t.refunds).values(rows).onConflictDoNothing());
  for (const rows of chunks(withdrawals)) statements.push(db.insert(t.withdrawals).values(rows).onConflictDoNothing());
  for (const rows of chunks([...skips.values()])) {
    statements.push(
      db
        .insert(t.settlementSkips)
        .values(rows)
        .onConflictDoUpdate({
          target: [t.settlementSkips.campaignId, t.settlementSkips.eventId, t.settlementSkips.attendee],
          set: { status: sql`excluded.status`, block: sql`excluded.block`, tx: sql`excluded.tx` },
          setWhere: sql`${t.settlementSkips.block} <= excluded.block`,
        }),
    );
  }
  for (const rows of chunks([...txs.values()])) statements.push(db.insert(t.transactions).values(rows).onConflictDoNothing());
  const now = new Date();
  const profileRows = [...profiles].map(([address, firstSeenBlock]) => ({ address, firstSeenBlock, updatedAt: now }));
  for (const rows of chunks(profileRows)) {
    statements.push(
      db
        .insert(t.profiles)
        .values(rows)
        .onConflictDoUpdate({
          target: t.profiles.address,
          set: { firstSeenBlock: sql`least(${t.profiles.firstSeenBlock}, excluded.first_seen_block)` },
        }),
    );
  }
  if (touchedEvents.size > 0) {
    const ids = [...touchedEvents];
    statements.push(
      db
        .update(t.events)
        .set({ checkedIn: sql`(select count(*)::int from ${t.presences} where ${t.presences.eventId} = ${t.events.id})` })
        .where(inArray(t.events.id, ids)),
    );
  }
  return statements;
}

export function syncStateStatement(db: Db, chainId: number, contracts: string[], lastBlock: bigint): Statement {
  return db
    .insert(t.syncState)
    .values(contracts.map((contract) => ({ chainId, contract: lower(contract), lastBlock })))
    .onConflictDoUpdate({ target: [t.syncState.chainId, t.syncState.contract], set: { lastBlock: sql`excluded.last_block` } });
}
