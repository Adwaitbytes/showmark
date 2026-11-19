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
