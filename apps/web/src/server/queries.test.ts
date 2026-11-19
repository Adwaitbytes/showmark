import { eq } from "drizzle-orm";
import { zeroAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import { setChainContext } from "./chain";
import { setDatabase } from "./db/client";
import * as t from "./db/schema";
import { AppError } from "./errors";
import { MemoryStore, setStore } from "./kv";
import { nameRegistryAbi } from "./qie/names";
import { getCampaign, getEvent, getPassport, getTraction, listCampaigns, listEvents } from "./queries";
import { fakeChainClient } from "./testing/fake-chain";
import { FIXTURE_CHAIN_ID, indexFixture, organizer, pass, pass2, endsAt, registry, sponsor, startsAt, vault, wallet } from "./testing/fixtures";
import { createTestDatabase } from "./testing/pglite";

const names: Address = "0x6000000000000000000000000000000000000006";
const qusdc: Address = "0x5000000000000000000000000000000000000005";
const claimed = 693n * 10n ** 15n;

let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase();
  await indexFixture(database);
  setDatabase(database);
  const kv = new MemoryStore();
  // The index is already current and the explorer figure is known, so no test reaches the network.
  await kv.set(`idx:fresh:${FIXTURE_CHAIN_ID}`, "1", { px: 600_000 });
  // The explorer's latest complete day is the fixture's day, so the share compares the same window.
  const fixtureDay = new Date(Number(startsAt) * 1000).toISOString().slice(0, 10);
  await kv.set(`traction:chain-day:${FIXTURE_CHAIN_ID}`, JSON.stringify({ date: fixtureDay, transactions: 1000 }), { px: 600_000 });
  setStore(kv);
  const client = fakeChainClient({
    [vault]: {
      abi: vaultAbi,
      handler: (fn, args) => {
        if (fn === "claimable") return args[0] === zeroAddress && String(args[1]).toLowerCase() === pass.toLowerCase() ? claimed : 0n;
        throw new Error(`unexpected vault call ${fn}`);
      },
    },
    [registry]: {
      abi: registryAbi,
      handler: (fn) => {
        if (fn === "streakOf") return [1, 1];
        throw new Error(`unexpected registry call ${fn}`);
      },
    },
    [names]: {
      abi: nameRegistryAbi,
      handler: (fn, args) => {
        const isWallet = String(args[0]).toLowerCase() === wallet.toLowerCase();
        if (fn === "userDomain") return isWallet ? "guest.qie" : "";
        if (fn === "resolver") return args[0] === "guest.qie" ? [1n, wallet] : [0n, zeroAddress];
        throw new Error(`unexpected name registry call ${fn}`);
      },
    },
  });
  setChainContext({ chainId: FIXTURE_CHAIN_ID, client, registry, vault, bond: zeroAddress, qusdc, oracle: zeroAddress, nameRegistry: names, paidNameRegistry: zeroAddress, deployBlock: 0n });
});

afterAll(async () => {
  setChainContext(null);
  setDatabase(null);
  setStore(null);
  await database.close();
});

describe("events", () => {
  it("lists indexed events with parsed metadata and live counts", async () => {
    const events = await listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "1", organizer, organizerName: null, capacity: 100, checkedIn: 2, seriesId: "1", seriesIndex: 1 });
    expect(events[0].metadata).toEqual({ v: 1, name: "Delhi builders night 2", venue: "Hall C", city: "Delhi", description: "" });
    expect(await listEvents({ organizer: sponsor })).toEqual([]);
    expect(await listEvents({ upcoming: true })).toHaveLength(1);
  });

  it("returns an event with the campaigns paying for it and recent check-ins", async () => {
    const event = await getEvent("1");
    expect(event?.campaigns).toEqual([
      {
        id: "1",
        name: "Show up and earn",
        sponsorName: "Acme",
        token: zeroAddress,
        tokenSymbol: "QIE",
        attendeeAmount: claimed.toString(),
        requireQieId: false,
        minProofMode: 1,
      },
    ]);
    expect(event?.recentCheckIns.map((c) => c.attendee).sort()).toEqual([pass, pass2].sort());
  });

  it("returns null for unknown events and rejects malformed ids", async () => {
    expect(await getEvent("2")).toBeNull();
    await expect(getEvent("abc")).rejects.toBeInstanceOf(AppError);
  });
});

describe("passport", () => {
  it("resolves a linked pass and reads balances and streaks from the chain", async () => {
    const passport = await getPassport(pass.toLowerCase());
    expect(passport).toMatchObject({ pass, wallet, holdsQieId: true, qieName: "guest.qie", pending: [] });
    expect(passport?.stamps).toHaveLength(1);
    expect(passport?.stamps[0]).toMatchObject({ eventId: "1", eventName: "Delhi builders night 2", city: "Delhi", mode: 1, streak: 1 });
    expect(passport?.streaks).toEqual([{ seriesId: "1", seriesName: "Builders nights", current: 1, best: 1 }]);
    expect(passport?.claimable).toEqual([
      { token: zeroAddress, symbol: "QIE", amount: claimed.toString() },
      { token: qusdc, symbol: "QUSDC", amount: "0" },
    ]);
  });

  it("finds the pass from its linked wallet", async () => {
    expect((await getPassport(wallet))?.pass).toBe(pass);
  });

  it("explains payouts that are waiting", async () => {
    const passport = await getPassport(pass2);
    expect(passport).toMatchObject({ pass: pass2, wallet: null, holdsQieId: false });
    expect(passport?.pending).toEqual([
      { campaignId: "1", eventId: "1", reason: "NeedsQieId", deadline: new Date(Number(endsAt + 3n * 86_400n) * 1000).toISOString() },
    ]);
  });

  it("returns null for names that do not exist and rejects garbage", async () => {
    expect(await getPassport("nobody.qie")).toBeNull();
    expect((await getPassport("Guest.QIE"))?.pass).toBe(pass);
    await expect(getPassport("not an address")).rejects.toMatchObject({ status: 400 });
  });
});

describe("campaigns", () => {
  it("derives balance, counts and status from vault logs", async () => {
    const [campaign] = await listCampaigns();
    expect(campaign).toMatchObject({
      id: "1",
      sponsor,
      tokenSymbol: "QIE",
      funded: (50n * 10n ** 18n).toString(),
      balance: (49n * 10n ** 18n).toString(),
      settledCount: 1,
      settledAmount: (10n ** 18n).toString(),
      teamFunded: true,
      status: "live",
      maxPerEvent: 0,
      maxTotal: 0,
      openToBonded: false,
      minBond: "0",
      challengeDeadline: null,
    });
    expect(await listCampaigns({ sponsor: organizer })).toEqual([]);
  });

  it("returns approved events and settlements with transaction hashes", async () => {
    await database.db.update(t.profiles).set({ qieName: "guest.qie" }).where(eq(t.profiles.address, wallet.toLowerCase()));
    const detail = await getCampaign("1");
    expect(detail?.events).toHaveLength(1);
    expect(detail?.events[0]).toMatchObject({ id: "1", approved: true, settled: 1 });
    expect(detail?.settlements).toHaveLength(1);
    expect(detail?.settlements[0]).toMatchObject({ attendee: pass, attendeeName: "guest.qie", organizer, organizerName: null, eventName: "Delhi builders night 2", gross: (10n ** 18n).toString() });
    expect(detail?.settlements[0].tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await getCampaign("99")).toBeNull();
  });
});

describe("traction", () => {
  it("counts real activity and separates team-funded pools", async () => {
    const traction = await getTraction();
    expect(traction).toMatchObject({
      verifiedAttendees: 2,
      eventsWithCheckIns: 1,
      organizers: 1,
      sponsors: { teamFunded: 1, external: 0 },
      settled: [{ token: zeroAddress, symbol: "QIE", teamFunded: (10n ** 18n).toString(), external: "0" }],
      passesLinked: 1,
      conversionRate: 0.5,
      repeatAttendees: 0,
      showmarkTransactions: 11,
      chainDailyTransactions: 1000,
    });
    expect(traction.daily).toHaveLength(30);
    expect(traction.daily.reduce((sum, d) => sum + d.checkIns, 0)).toBe(2);
    expect(traction.shareOfChainDaily).toBeCloseTo(0.011);
  });
});
