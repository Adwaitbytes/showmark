import { eq } from "drizzle-orm";
import { createPublicClient, custom, zeroAddress, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qieTestnet } from "@/lib/chain/chains";
import { setChainContext } from "./chain";
import { setDatabase } from "./db/client";
import * as t from "./db/schema";
import { MemoryStore, setStore } from "./kv";
import { getEvent, getPassport, getTraction } from "./queries";
import { FIXTURE_CHAIN_ID, indexFixture, pass, registry, startsAt, vault, wallet } from "./testing/fixtures";
import { createTestDatabase } from "./testing/pglite";

// QA M5: a node that accepts requests and never answers. Every page query must still finish within its read
// budget and show what is indexed; only a request with nothing indexed to fall back on may fail, as chain_slow.

const names: Address = "0x6000000000000000000000000000000000000006";
let database: Awaited<ReturnType<typeof createTestDatabase>>;

const hanging = createPublicClient({
  chain: qieTestnet,
  transport: custom({ request: () => new Promise<never>(() => {}) }),
});

beforeAll(async () => {
  database = await createTestDatabase();
  await indexFixture(database);
  setDatabase(database);
  const kv = new MemoryStore();
  const day = new Date(Number(startsAt) * 1000).toISOString().slice(0, 10);
  await kv.set(`traction:chain-day:${FIXTURE_CHAIN_ID}`, JSON.stringify({ date: day, transactions: 5 }), { px: 600_000 });
  setStore(kv);
  setChainContext({
    chainId: FIXTURE_CHAIN_ID,
    client: hanging,
    registry,
    vault,
    bond: zeroAddress,
    qusdc: zeroAddress,
    oracle: "0x8000000000000000000000000000000000000008",
    nameRegistry: names,
    paidNameRegistry: zeroAddress,
    deployBlock: 0n,
  });
});

afterAll(async () => {
  setChainContext(null);
  setDatabase(null);
  setStore(null);
  await database.close();
});

async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work;
  return { value, ms: Date.now() - started };
}

describe("queries against a chain that never answers", () => {
  it("renders a passport from indexed data within the read budget", async () => {
    const { value, ms } = await timed(getPassport(pass));
    expect(ms).toBeLessThan(9_000);
    expect(value?.stamps).toHaveLength(1);
    // Claimable comes from vault logs (0.693 QIE credited, nothing withdrawn); the streak from presences.
    expect(value?.claimable).toEqual([{ token: zeroAddress, symbol: "QIE", amount: (693n * 10n ** 15n).toString() }]);
    expect(value?.streaks).toEqual([{ seriesId: "1", seriesName: "Builders nights", current: 1, best: 1 }]);
    expect(value?.wallet).toBe(wallet);
  }, 20_000);

  it("serves an event and traction without waiting on the chain", async () => {
    expect((await timed(getEvent("1"))).ms).toBeLessThan(9_000);
    const { value } = await timed(getTraction());
    expect(value.verifiedAttendees).toBe(2);
    expect(value.settledUsd.price).toBe(0);
  }, 30_000);

  it("never shows a share above 100 percent", async () => {
    // 11 Showmark transactions against an explorer figure of 5 for the same day: a bad figure, so no share.
    const traction = await getTraction();
    expect(traction.shareOfChainDaily).toBeNull();
  }, 20_000);

  it("answers a name from indexed profiles, and says chain_slow only when nothing is indexed", async () => {
    await database.db.update(t.profiles).set({ qieName: "guest.qie" }).where(eq(t.profiles.address, wallet.toLowerCase()));
    expect((await getPassport("guest.qie"))?.pass).toBe(pass);
    await expect(getPassport("stranger.qie")).rejects.toMatchObject({ status: 503, copy: { code: "chain_slow" } });
  }, 30_000);
});
