import { zeroAddress, type Address, type Log } from "viem";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import type { Database } from "../db/client";
import { buildStatements, syncStateStatement } from "../indexer/apply";
import { decodeShowmarkLogs } from "../indexer/decode";
import { encodeLog } from "./logs";

// One small, realistic history shared by the indexer and query tests: a series, an event, a team-funded native QIE
// campaign approved for it, two check-ins, one payout, one payout skipped for a missing QIE ID, and a wallet link.

export const registry: Address = "0x1000000000000000000000000000000000000001";
export const vault: Address = "0x2000000000000000000000000000000000000002";
export const organizer: Address = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e";
export const sponsor: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const pass: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
export const pass2: Address = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
export const wallet: Address = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
export const doorKey: Address = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";

/** The event started an hour before the test run and ends an hour after, so it is live and its campaign can pay. */
export const startsAt = BigInt(Math.floor(Date.now() / 1000)) - 3_600n;
export const endsAt = startsAt + 7_200n;
const eventMeta = JSON.stringify({ v: 1, name: "Delhi builders night", venue: "Hall B", city: "Delhi", description: "Talks and demos", url: "https://example.org/e" });
const campaignMeta = JSON.stringify({ v: 1, name: "Show up and earn", sponsor: "Acme", description: "Pays every verified guest" });

export function fixtureLogs(): Log[] {
  return [
    encodeLog(registryAbi, "SeriesCreated", { seriesId: 1n, organizer, metadata: JSON.stringify({ name: "Builders nights" }) }, { address: registry, block: 100n, logIndex: 0 }),
    encodeLog(
      registryAbi,
      "EventCreated",
      { eventId: 1n, organizer, startsAt, endsAt, capacity: 100, maxPassAge: 60, seriesId: 1n, seriesIndex: 1, metadata: eventMeta },
      { address: registry, block: 100n, logIndex: 1 },
    ),
    encodeLog(vaultAbi, "CampaignCreated", {
      campaignId: 1n,
      sponsor,
      token: zeroAddress,
      pricing: 0,
      amountPerPresence: 10n ** 18n,
      attendeeShareBps: 7_000,
      minProofMode: 1,
      requireQieId: false,
      startsAt,
      endsAt,
      feeBps: 100,
      metadata: campaignMeta,
    }, { address: vault, block: 101n, logIndex: 0 }),
    encodeLog(vaultAbi, "CampaignFunded", { campaignId: 1n, from: sponsor, amount: 50n * 10n ** 18n }, { address: vault, block: 101n, logIndex: 1 }),
    encodeLog(vaultAbi, "EventsApproved", { campaignId: 1n, eventIds: [1n] }, { address: vault, block: 102n, logIndex: 0 }),
    encodeLog(registryAbi, "CheckedIn", { eventId: 1n, attendee: pass, mode: 1, doorKey, doorTime: startsAt + 10n, streak: 1 }, { address: registry, block: 103n, logIndex: 0 }),
    encodeLog(registryAbi, "CheckedIn", { eventId: 1n, attendee: pass2, mode: 2, doorKey, doorTime: startsAt + 20n, streak: 1 }, { address: registry, block: 103n, logIndex: 1 }),
    encodeLog(
      vaultAbi,
      "Settled",
      { campaignId: 1n, eventId: 1n, attendee: pass, organizer, gross: 10n ** 18n, toAttendee: 693n * 10n ** 15n, toOrganizer: 297n * 10n ** 15n, fee: 10n ** 16n, price: 0n },
      { address: vault, block: 103n, logIndex: 2 },
    ),
    encodeLog(vaultAbi, "SettlementSkipped", { campaignId: 1n, eventId: 1n, attendee: pass2, status: 8 }, { address: vault, block: 103n, logIndex: 3 }),
    encodeLog(registryAbi, "WalletLinked", { pass, wallet }, { address: registry, block: 104n, logIndex: 0 }),
    encodeLog(registryAbi, "EventMetadataUpdated", { eventId: 1n, metadata: JSON.stringify({ v: 1, name: "Delhi builders night 2", venue: "Hall C", city: "Delhi", description: "" }) }, { address: registry, block: 105n, logIndex: 0 }),
  ];
}

export const blockTimes = new Map([100n, 101n, 102n, 103n, 104n, 105n].map((b) => [b, new Date(Number(startsAt + (b - 100n) * 4n) * 1000)] as const));


export const FIXTURE_CHAIN_ID = 1983;

export async function indexFixture(database: Database, teamAddresses: ReadonlySet<Address> = new Set([sponsor])): Promise<void> {
  const decoded = decodeShowmarkLogs(fixtureLogs(), { registry, vault });
  const statements = buildStatements(database.db, decoded, blockTimes, { teamAddresses });
  statements.push(syncStateStatement(database.db, FIXTURE_CHAIN_ID, [registry, vault], 105n));
  await database.batch(statements);
}
