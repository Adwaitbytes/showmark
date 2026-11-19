import { describe, expect, it } from "vitest";
import type { CampaignDetail } from "@/lib/api/types";
import { AppError, COMMON_ERRORS } from "./errors";
import { cacheControl, CACHE, errorResponse, readJson } from "./http";
import { MemoryRateLimiter, MemoryStore } from "./kv";
import { tryLock } from "./lock";
import { dexQuote, dexQuoteQuerySchema, quoteUrl } from "./qie/dex";
import { campaignCsv, csvField } from "./report";
import { checkInBatchSchema, checkInDataSchema, eventsQuerySchema, linkWalletSchema, txHashSchema } from "./schemas";

const sig = `0x${"ab".repeat(65)}`;
const attendee = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const ticket = "0x3000000000000000000000000000000000000003";
const valid = { eventId: "12", attendee, mode: 1, doorTime: "1795000000", ticket, attendeeSig: sig, doorSig: sig, ticketSig: sig };
const attested = { ...valid, mode: 2, ticket: "0x0000000000000000000000000000000000000000", ticketSig: "0x" };

describe("wire schemas", () => {
  it("parses check-in data into bigints and a checksummed address", () => {
    const parsed = checkInDataSchema.parse(valid);
    expect(parsed).toEqual({ ...valid, eventId: 12n, doorTime: 1_795_000_000n, attendee: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" });
  });

  it("rejects malformed check-ins", () => {
    for (const bad of [
      { ...valid, eventId: "0" },
      { ...valid, eventId: "-1" },
      { ...valid, eventId: 12 },
      { ...valid, mode: 3 },
      { ...valid, doorTime: (2n ** 64n).toString() },
      { ...valid, attendee: "0x123" },
      { ...valid, attendeeSig: `0x${"ab".repeat(64)}` },
      { ...valid, doorSig: "not hex" },
      { ...valid, ticket: attested.ticket },
      { ...valid, ticketSig: "0x" },
      { ...attested, ticket },
      { ...attested, ticketSig: sig },
      { ...valid, ticketSig: `0x${"ab".repeat(64)}` },
    ]) {
      expect(checkInDataSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts a door-scans-you attestation with no ticket", () => {
    expect(checkInDataSchema.parse(attested)).toMatchObject({ mode: 2, ticketSig: "0x" });
  });

  it("caps batches at 50 items", () => {
    expect(checkInBatchSchema.safeParse({ items: Array(50).fill(valid) }).success).toBe(true);
    expect(checkInBatchSchema.safeParse({ items: Array(51).fill(valid) }).success).toBe(false);
    expect(checkInBatchSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("accepts contract wallet signatures of any reasonable length for link-wallet", () => {
    const base = { pass: attendee, wallet: attendee, deadline: "1795000000", passSig: sig, relocateEventIds: ["1"] };
    expect(linkWalletSchema.safeParse({ ...base, walletSig: `0x${"cd".repeat(200)}` }).success).toBe(true);
    expect(linkWalletSchema.safeParse({ ...base, walletSig: "0xabc" }).success).toBe(false);
  });

  it("parses query strings", () => {
    expect(eventsQuerySchema.parse({ upcoming: "1", limit: "10" })).toEqual({ upcoming: true, limit: 10 });
    expect(eventsQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
    expect(txHashSchema.safeParse(`0x${"AB".repeat(32)}`).data).toBe(`0x${"ab".repeat(32)}`);
  });
});

describe("http helpers", () => {
  it("answers AppError with the ApiError shape and its status", async () => {
    const res = errorResponse(new AppError(429, COMMON_ERRORS.upstream, { headers: { "retry-after": "12" } }), "test");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: COMMON_ERRORS.upstream });
  });

  it("never leaks unexpected errors", async () => {
    const res = errorResponse(new Error("secret internals"), "test");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internals");
  });

  it("rejects oversized and malformed bodies", async () => {
    const big = new Request("http://x/", { method: "POST", body: "x".repeat(70_000) });
    await expect(readJson(big, checkInDataSchema)).rejects.toMatchObject({ status: 413 });
    const bad = new Request("http://x/", { method: "POST", body: "{" });
    await expect(readJson(bad, checkInDataSchema)).rejects.toMatchObject({ status: 400 });
    const wrong = new Request("http://x/", { method: "POST", body: JSON.stringify({ ...valid, mode: 7 }) });
    await expect(readJson(wrong, checkInDataSchema)).rejects.toMatchObject({ status: 400, copy: { message: expect.stringContaining("mode") } });
  });

  it("builds cache headers", () => {
    expect(cacheControl(CACHE.live)).toBe("public, max-age=0, s-maxage=5, stale-while-revalidate=30");
    expect(cacheControl(CACHE.immutable)).toBe("public, max-age=31536000, immutable");
  });
});

describe("csv report", () => {
  it("defuses spreadsheet formulas and quotes separators", () => {
    expect(csvField("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("plain")).toBe("plain");
  });

  it("writes one row per settlement with an explorer link", () => {
    const campaign = {
      id: "1",
      tokenSymbol: "QIE",
      settlements: [
        {
          campaignId: "1",
          eventId: "2",
          eventName: "@night, Delhi",
          attendee: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
          organizer: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
          gross: "100",
          toAttendee: "60",
          toOrganizer: "39",
          fee: "1",
          at: "2026-11-19T10:00:00.000Z",
          tx: `0x${"aa".repeat(32)}`,
        },
      ],
    } as unknown as CampaignDetail;
    const lines = campaignCsv(campaign).trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^campaign_id,event_id,event_name/);
    expect(lines[1]).toContain(`"'@night, Delhi"`);
    expect(lines[1]).toMatch(/\/tx\/0x(aa){32}$/);
  });
});

describe("QIEDEX quote proxy", () => {
  const upstream = {
    chainId: 1990,
    tokenIn: { address: "0xeeee", symbol: "QIE", decimals: 18 },
    tokenOut: { address: "0x3f43", symbol: "QUSDC", decimals: 6 },
    amountIn: "1",
    amountOut: "2",
    minAmountOut: "1",
    path: [],
    priceImpactPct: 0.1,
    warnings: [],
    quotedAt: 1,
    extra: "kept",
  };

  it("requires exactly one amount and normalizes native QIE", () => {
    const q = dexQuoteQuerySchema.parse({ tokenIn: "qie", tokenOut: "0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5", amountInDecimal: "10" });
    expect(q.tokenIn).toBe("QIE");
    expect(quoteUrl(q)).toBe("https://api.dex.qie.digital/quote?amountInDecimal=10&tokenIn=QIE&tokenOut=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5");
    expect(dexQuoteQuerySchema.safeParse({ tokenIn: "QIE", tokenOut: "QIE" }).success).toBe(false);
    expect(dexQuoteQuerySchema.safeParse({ tokenIn: "QIE", tokenOut: "QIE", amountIn: "1", amountOut: "1" }).success).toBe(false);
    expect(dexQuoteQuerySchema.safeParse({ tokenIn: "QIE", tokenOut: "QIE", amountIn: "1", recipient: "x" }).success).toBe(false);
  });

  it("caches answers and only spends the upstream budget on a miss", async () => {
    const kv = new MemoryStore();
    let calls = 0;
    let budget = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json(upstream);
    }) as typeof fetch;
    const q = dexQuoteQuerySchema.parse({ tokenIn: "QIE", tokenOut: "QIE", amountIn: "1" });
    const first = await dexQuote(q, kv, async () => void (budget += 1), fetchImpl);
    const second = await dexQuote(q, kv, async () => void (budget += 1), fetchImpl);
    expect(first).toEqual(upstream);
    expect(second).toEqual(upstream);
    expect(calls).toBe(1);
    expect(budget).toBe(1);
  });

  it("maps upstream failures to plain errors", async () => {
    const q = dexQuoteQuerySchema.parse({ tokenIn: "QIE", tokenOut: "QIE", amountIn: "1" });
    const answer = (status: number) => (async () => Response.json({ error: "x" }, { status })) as typeof fetch;
    await expect(dexQuote(q, new MemoryStore(), async () => {}, answer(404))).rejects.toMatchObject({ status: 404, copy: { code: "dex_no_route" } });
    await expect(dexQuote(q, new MemoryStore(), async () => {}, answer(429))).rejects.toMatchObject({ status: 503, copy: { code: "dex_busy" } });
    await expect(dexQuote(q, new MemoryStore(), async () => {}, (async () => Response.json({ chainId: "no" })) as typeof fetch)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("memory store and locks", () => {
  it("implements NX, PX, compare-and-delete and lists like Redis", async () => {
    let now = 0;
    const kv = new MemoryStore(() => now);
    expect(await kv.set("k", "a", { nx: true, px: 100 })).toBe(true);
    expect(await kv.set("k", "b", { nx: true, px: 100 })).toBe(false);
    expect(await kv.deleteIfEquals("k", "b")).toBe(false);
    now = 100;
    expect(await kv.get("k")).toBeNull();
    await kv.rpush("q", ["1", "2", "3"]);
    expect(await kv.lpop("q", 2)).toEqual(["1", "2"]);
    expect(await kv.llen("q")).toBe(1);
    expect(await kv.mget(["q", "missing"])).toEqual([null, null]);
  });

  it("lets only one holder take a lock, and only the holder release it", async () => {
    const kv = new MemoryStore();
    const a = await tryLock(kv, "lock", 1_000);
    expect(a).not.toBeNull();
    expect(await tryLock(kv, "lock", 1_000)).toBeNull();
    await kv.del("lock");
    const b = await tryLock(kv, "lock", 1_000);
    await a?.release();
    expect(await kv.get("lock")).toBe(b?.token);
    expect(await a?.extend(1_000)).toBe(false);
  });

  it("limits with a sliding window", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(3, 60_000, () => now);
    for (let i = 0; i < 3; i++) expect((await limiter.limit("ip")).success).toBe(true);
    expect((await limiter.limit("ip")).success).toBe(false);
    expect((await limiter.limit("other")).success).toBe(true);
    now = 60_001;
    expect((await limiter.limit("ip")).success).toBe(true);
  });
});
