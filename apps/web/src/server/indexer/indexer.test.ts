import { parseAbi, zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bondAbi, registryAbi, vaultAbi } from "@/lib/chain/abi";
import { payingCampaignIds } from "../payouts";
import * as t from "../db/schema";
import { blockTimes, doorKey, fixtureLogs, indexFixture, organizer, pass, pass2, registry, sponsor, startsAt, vault, wallet } from "../testing/fixtures";
import { createTestDatabase } from "../testing/pglite";
import { encodeLog } from "../testing/logs";
import { buildStatements } from "./apply";
import { decodeShowmarkLogs } from "./decode";
import { parseCampaignMetadata, parseEventMetadata, parseSeriesName } from "./metadata";

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
    const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const foreign = encodeLog(registryAbi, "WalletLinked", { pass, wallet }, { address: "0x3000000000000000000000000000000000000003", block: 1n, logIndex: 0 });
    const notOurs = encodeLog(erc20, "Transfer", { from: zeroAddress, to: organizer, value: 1n }, { address: registry, block: 1n, logIndex: 1 });
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

  const applyFixture = () => indexFixture(database);

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

  it("indexes opt-ins to open campaigns and bond challenges, and pays opted-in organizers' events", async () => {
    await applyFixture();
    const bond = "0x7000000000000000000000000000000000000007";
    const logs = [
      encodeLog(vaultAbi, "OpenCampaignJoined", { campaignId: 5n, organizer }, { address: vault, block: 106n, logIndex: 0 }),
      // Housekeeping events from the same contracts are counted, never mistaken for an opt-in.
      encodeLog(vaultAbi, "OwnershipTransferred", { previousOwner: zeroAddress, newOwner: sponsor }, { address: vault, block: 106n, logIndex: 4 }),
      encodeLog(bondAbi, "Bonded", { organizer, amount: 5n, bonded: 5n }, { address: bond, block: 106n, logIndex: 5 }),
      encodeLog(bondAbi, "Challenged", { challengeId: 1n, organizer, campaignId: 5n, sponsor, reason: "no show" }, { address: bond, block: 106n, logIndex: 1, tx: `0x${"cd".repeat(32)}` }),
      encodeLog(bondAbi, "ClaimFiled", { challengeId: 1n, organizer, claim: 10n, deposit: 1n }, { address: bond, block: 106n, logIndex: 2, tx: `0x${"cd".repeat(32)}` }),
      encodeLog(bondAbi, "ClaimRefreshed", { challengeId: 1n, organizer, claim: 25n }, { address: bond, block: 106n, logIndex: 3 }),
    ];
    const times = new Map([[106n, new Date()]]);
    await database.batch(buildStatements(database.db, decodeShowmarkLogs(logs, { registry, vault, bond }), times, { teamAddresses: new Set() }));
    expect(await database.db.select().from(t.campaignOptIns)).toMatchObject([{ campaignId: 5n, organizer: organizer.toLowerCase(), optedIn: true }]);
    expect(await database.db.select().from(t.challenges)).toMatchObject([{ id: 1n, campaignId: 5n, claim: 25n, resolved: false }]);

    // Campaign 5 is open to bonded organizers and was never approved for event 1, yet it pays there via the opt-in.
    await database.db.insert(t.campaigns).values({
      id: 5n, sponsor: sponsor.toLowerCase(), token: zeroAddress, pricing: 0, amountPerPresence: 1n, attendeeShareBps: 5_000, minProofMode: 1,
      requireQieId: false, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000), feeBps: 0, name: "Open",
      sponsorName: "", description: "", teamFunded: false, openToBonded: true, createdBlock: 106n, createdTx: "0x",
    });
    expect(await payingCampaignIds(database.db, 1n)).toEqual([1n, 5n]);

    const resolved = encodeLog(bondAbi, "Resolved", { challengeId: 1n, organizer, slashed: 4n, recipient: sponsor }, { address: bond, block: 107n, logIndex: 0 });
    const left = encodeLog(vaultAbi, "OpenCampaignLeft", { campaignId: 5n, organizer }, { address: vault, block: 107n, logIndex: 1 });
    await database.batch(buildStatements(database.db, decodeShowmarkLogs([resolved, left], { registry, vault, bond }), new Map([[107n, new Date()]]), { teamAddresses: new Set() }));
    expect(await database.db.select().from(t.challenges)).toMatchObject([{ resolved: true, slashed: 4n }]);
    expect(await payingCampaignIds(database.db, 1n)).toEqual([1n]);
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
