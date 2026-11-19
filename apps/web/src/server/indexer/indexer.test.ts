import { parseAbi, zeroAddress, type Address, type Log } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import * as t from "../db/schema";
import { createTestDatabase } from "../testing/pglite";
import { encodeLog } from "../testing/logs";
import { buildStatements, syncStateStatement } from "./apply";
import { decodeShowmarkLogs } from "./decode";
import { parseCampaignMetadata, parseEventMetadata, parseSeriesName } from "./metadata";

const registry: Address = "0x1000000000000000000000000000000000000001";
const vault: Address = "0x2000000000000000000000000000000000000002";
const organizer: Address = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e";
const sponsor: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const pass: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const pass2: Address = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const wallet: Address = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
const doorKey: Address = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";

const startsAt = 1_795_000_000n;
const endsAt = startsAt + 7_200n;
const eventMeta = JSON.stringify({ v: 1, name: "Delhi builders night", venue: "Hall B", city: "Delhi", description: "Talks and demos", url: "https://example.org/e" });
const campaignMeta = JSON.stringify({ v: 1, name: "Show up and earn", sponsor: "Acme", description: "Pays every verified guest" });

function fixtureLogs(): Log[] {
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

const blockTimes = new Map([100n, 101n, 102n, 103n, 104n, 105n].map((b) => [b, new Date(Number(startsAt + (b - 100n) * 4n) * 1000)] as const));

describe("decodeShowmarkLogs", () => {
  it("decodes registry and vault logs with their own ABIs, in chain order", () => {
    const logs = fixtureLogs();
    const shuffled = [...logs].reverse();
    const decoded = decodeShowmarkLogs(shuffled, { registry, vault });
    expect(decoded.map((l) => l.eventName)).toEqual([
      "SeriesCreated",
      "EventCreated",
      "CampaignCreated",
      "CampaignFunded",
      "EventsApproved",
      "CheckedIn",
      "CheckedIn",
      "Settled",
      "SettlementSkipped",
      "WalletLinked",
      "EventMetadataUpdated",
    ]);
    const checkIn = decoded[5];
    if (checkIn.eventName !== "CheckedIn") throw new Error("expected CheckedIn");
    expect(checkIn.args).toEqual({ eventId: 1n, attendee: pass, mode: 1, doorKey, doorTime: startsAt + 10n, streak: 1 });
  });

  it("drops logs from other addresses and events outside the Showmark ABI", () => {
    const ownable = parseAbi(["event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)"]);
    const foreign = encodeLog(registryAbi, "WalletLinked", { pass, wallet }, { address: "0x3000000000000000000000000000000000000003", block: 1n, logIndex: 0 });
    const notOurs = encodeLog(ownable, "OwnershipTransferred", { previousOwner: zeroAddress, newOwner: organizer }, { address: registry, block: 1n, logIndex: 1 });
    // A registry event emitted by the vault address must not decode as a vault event.
    const wrongContract = encodeLog(registryAbi, "WalletLinked", { pass, wallet }, { address: vault, block: 1n, logIndex: 2 });
    expect(decodeShowmarkLogs([foreign, notOurs, wrongContract], { registry, vault })).toEqual([]);
  });
});

describe("metadata parsing", () => {
  it("keeps valid fields and drops unsafe links", () => {
    expect(parseEventMetadata(JSON.stringify({ v: 1, name: " Night ", venue: "A", city: "B", description: "C", url: "javascript:alert(1)" }), 3n)).toEqual({
      name: "Night",
      venue: "A",
      city: "B",
      description: "C",
      url: null,
    });
  });

  it("falls back to a plain name when the JSON is malformed", () => {
    expect(parseEventMetadata("{not json", 7n).name).toBe("Event 7");
    expect(parseCampaignMetadata("", 2n).name).toBe("Campaign 2");
    expect(parseSeriesName("Weekly runs", 4n)).toBe("Weekly runs");
    expect(parseSeriesName("{\"oops\":1}", 4n)).toBe("Series 4");
  });
});

describe("buildStatements on Postgres", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  async function applyFixture() {
    const decoded = decodeShowmarkLogs(fixtureLogs(), { registry, vault });
    const statements = buildStatements(database.db, decoded, blockTimes, { teamAddresses: new Set([sponsor]) });
    statements.push(syncStateStatement(database.db, 1983, [registry, vault], 105n));
    await database.batch(statements);
  }

  it("writes every table and is idempotent when the same range is applied twice", async () => {
    await applyFixture();
    await applyFixture();
    const { db } = database;

    const [event] = await db.select().from(t.events);
    expect(event).toMatchObject({ id: 1n, organizer: organizer.toLowerCase(), capacity: 100, checkedIn: 2, name: "Delhi builders night 2", venue: "Hall C", url: null });
    expect(await db.select().from(t.series)).toMatchObject([{ id: 1n, name: "Builders nights" }]);

    const presences = await db.select().from(t.presences);
    expect(presences).toHaveLength(2);
    expect(presences.find((p) => p.attendee === pass.toLowerCase())).toMatchObject({ mode: 1, streak: 1, doorKey: doorKey.toLowerCase(), block: 103n });

    const [campaign] = await db.select().from(t.campaigns);
    expect(campaign).toMatchObject({ id: 1n, amountPerPresence: 10n ** 18n, teamFunded: true, name: "Show up and earn", sponsorName: "Acme", feeBps: 100 });
    expect(await db.select().from(t.fundings)).toMatchObject([{ campaignId: 1n, amount: 50n * 10n ** 18n }]);
    expect(await db.select().from(t.campaignEvents)).toEqual([{ campaignId: 1n, eventId: 1n, approved: true }]);
    expect(await db.select().from(t.settlements)).toMatchObject([{ attendee: pass.toLowerCase(), gross: 10n ** 18n, fee: 10n ** 16n }]);
    expect(await db.select().from(t.settlementSkips)).toMatchObject([{ attendee: pass2.toLowerCase(), status: 8 }]);
    expect(await db.select().from(t.links)).toMatchObject([{ pass: pass.toLowerCase(), wallet: wallet.toLowerCase() }]);

    const profiles = await db.select().from(t.profiles);
    expect(profiles.map((p) => p.address).sort()).toEqual([organizer, sponsor, wallet].map((a) => a.toLowerCase()).sort());
    expect(profiles.find((p) => p.address === organizer.toLowerCase())?.firstSeenBlock).toBe(100n);

    const txs = await db.select().from(t.transactions);
    expect(txs).toHaveLength(11);
    expect(await db.select().from(t.syncState)).toHaveLength(2);
  });

  it("applies approvals and revocations in log order", async () => {
    const logs = [
      encodeLog(vaultAbi, "EventsApproved", { campaignId: 9n, eventIds: [1n, 2n, 2n] }, { address: vault, block: 100n, logIndex: 0 }),
      encodeLog(vaultAbi, "EventsRevoked", { campaignId: 9n, eventIds: [2n] }, { address: vault, block: 100n, logIndex: 1 }),
    ];
    const decoded = decodeShowmarkLogs(logs, { registry, vault });
    await database.batch(buildStatements(database.db, decoded, blockTimes, { teamAddresses: new Set() }));
    const rows = await database.db.select().from(t.campaignEvents);
    expect(rows.sort((a, b) => Number(a.eventId - b.eventId))).toEqual([
      { campaignId: 9n, eventId: 1n, approved: true },
      { campaignId: 9n, eventId: 2n, approved: false },
    ]);
  });
});
