import { describe, expect, it } from "vitest";
import { apiRequest, parseEvent, parseSubmitted, parseTxState, type Fetcher } from "./api";

const TX = `0x${"ab".repeat(32)}`;

function fetchReturning(status: number, body: unknown): Fetcher {
  return async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("apiRequest", () => {
  it("returns the parsed body on success", async () => {
    const result = await apiRequest("/x", {}, parseSubmitted, { fetch: fetchReturning(200, { txHash: TX, status: "submitted" }) });
    expect(result).toEqual({ ok: true, data: { txHash: TX, status: "submitted" } });
  });

  it("carries the API's code, message and action on an error", async () => {
    const error = { error: { code: "stale", message: "The door code expired.", action: "Scan again." } };
    const result = await apiRequest("/x", {}, parseSubmitted, { fetch: fetchReturning(422, error) });
    expect(result).toEqual({ ok: false, failure: { kind: "api", status: 422, code: "stale", message: "The door code expired.", action: "Scan again." } });
  });

  it("falls back to the HTTP status when the error body is not ours", async () => {
    const result = await apiRequest("/x", {}, parseSubmitted, { fetch: fetchReturning(502, "<html>Bad gateway</html>") });
    expect(result).toEqual({ ok: false, failure: { kind: "api", status: 502, code: "http_502" } });
  });

  it("reports a malformed success body instead of passing it on", async () => {
    const result = await apiRequest("/x", {}, parseSubmitted, { fetch: fetchReturning(200, { txHash: "nope" }) });
    expect(result).toEqual({ ok: false, failure: { kind: "malformed", code: "malformed" } });
  });

  it("separates a dropped connection from a timeout", async () => {
    const dropped: Fetcher = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await apiRequest("/x", {}, parseSubmitted, { fetch: dropped })).toEqual({ ok: false, failure: { kind: "network", code: "network" } });

    const never: Fetcher = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    expect(await apiRequest("/x", {}, parseSubmitted, { fetch: never, timeoutMs: 10 })).toEqual({ ok: false, failure: { kind: "timeout", code: "timeout" } });
  });
});

describe("parsers", () => {
  it("accepts the tx status shapes and nothing else", () => {
    expect(parseTxState({ status: "pending" })).toEqual({ status: "pending" });
    expect(parseTxState({ status: "success", blockNumber: "42" })).toEqual({ status: "success", blockNumber: "42" });
    expect(parseTxState({ status: "done" })).toBeNull();
    expect(parseTxState({ status: "success", blockNumber: 42 })).toBeNull();
  });

  it("reads an event and rejects one with a bad campaign", () => {
    const event = {
      id: "12",
      startsAt: "2026-11-27T12:30:00.000Z",
      endsAt: "2026-11-27T15:30:00.000Z",
      capacity: 0,
      checkedIn: 3,
      metadata: { v: 1, name: "Meetup", venue: "Hall", city: "Pune", description: "" },
      campaigns: [{ id: "4", name: "C", sponsorName: "S", token: "0x0", tokenSymbol: "QIE", attendeeAmount: "100", requireQieId: false, minProofMode: 1 }],
    };
    expect(parseEvent(event)?.campaigns[0]).toEqual({ id: "4", name: "C", sponsorName: "S", tokenSymbol: "QIE", attendeeAmount: "100", requireQieId: false, minProofMode: 1 });
    expect(parseEvent({ ...event, campaigns: [{ ...event.campaigns[0], attendeeAmount: "1e18" }] })).toBeNull();
  });
});

describe("passport parsing", () => {
  const passport = {
    pass: "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
    wallet: null,
    qieName: null,
    holdsQieId: false,
    stamps: [{ eventId: "1", eventName: "Meetup", city: "Pune", at: "2026-11-19T10:00:00Z", mode: 1, tx: TX, streak: 0, extra: "dropped" }],
    streaks: [],
    claimable: [{ token: "0x0000000000000000000000000000000000000000", symbol: "QIE", amount: "6000000000000000" }],
    pending: [{ campaignId: "1", eventId: "1", reason: "NeedsQieId" }],
    unknownTopLevel: true,
  };

  it("keeps the declared fields and drops the rest", async () => {
    const { parsePassport } = await import("./api-passport");
    const parsed = parsePassport(passport);
    expect(parsed?.stamps[0]).toEqual({ eventId: "1", eventName: "Meetup", city: "Pune", at: "2026-11-19T10:00:00Z", mode: 1, tx: TX, streak: 0 });
    expect(parsed && "unknownTopLevel" in parsed).toBe(false);
  });

  it("rejects a wrong mode, symbol, amount or pending reason", async () => {
    const { parsePassport } = await import("./api-passport");
    expect(parsePassport({ ...passport, stamps: [{ ...passport.stamps[0], mode: 3 }] })).toBeNull();
    expect(parsePassport({ ...passport, claimable: [{ ...passport.claimable[0], symbol: "ETH" }] })).toBeNull();
    expect(parsePassport({ ...passport, claimable: [{ ...passport.claimable[0], amount: "1.5" }] })).toBeNull();
    expect(parsePassport({ ...passport, pending: [{ campaignId: "1", eventId: "1", reason: "Later" }] })).toBeNull();
  });
});
