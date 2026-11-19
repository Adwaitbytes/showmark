import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import type { ApiFailure, ApiResult, Submitted, TxState } from "./api";
import { classifyFailure, retryDelayMs } from "./errors";
import { createWaiter, runCheckIn, type CheckInDeps, type CheckInPhase } from "./machine";
import type { CheckInRequest } from "./sign";

const TX: Hex = `0x${"ab".repeat(32)}`;

const request: CheckInRequest = {
  eventId: "7",
  attendee: "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
  mode: 1,
  doorTime: "1764245000",
  ticket: "0x3333333333333333333333333333333333333333",
  attendeeSig: `0x${"11".repeat(65)}`,
  doorSig: `0x${"22".repeat(65)}`,
  ticketSig: `0x${"44".repeat(65)}`,
};

const fail = (failure: ApiFailure): ApiResult<never> => ({ ok: false, failure });
const apiError = (status: number, code: string): ApiFailure => ({ kind: "api", status, code, message: `${code} message`, action: `${code} action` });
const submitted: ApiResult<Submitted> = { ok: true, data: { txHash: TX, status: "submitted" } };
const tx = (status: TxState["status"]): ApiResult<TxState> => ({ ok: true, data: { status, blockNumber: "10" } });

interface Harness {
  deps: CheckInDeps;
  phases: CheckInPhase[];
  waits: (number | null)[];
  outbox: { saved: number; removed: number };
}

function harness(posts: ApiResult<Submitted>[], statuses: ApiResult<TxState>[] = [tx("success")], online = true): Harness {
  let clock = 1_000_000;
  const waits: (number | null)[] = [];
  const outbox = { saved: 0, removed: 0 };
  const deps: CheckInDeps = {
    postCheckIn: vi.fn(async () => posts.shift() ?? fail({ kind: "network", code: "network" })),
    txStatus: vi.fn(async () => statuses.shift() ?? tx("pending")),
    now: () => clock,
    isOnline: () => online,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms ?? 0;
    },
    outbox: { save: () => void outbox.saved++, remove: () => void outbox.removed++ },
  };
  return { deps, phases: [], waits, outbox };
}

async function run(h: Harness, options = { maxAttempts: 5, pollMs: 700, confirmTimeoutMs: 45_000 }) {
  return runCheckIn(request, h.deps, (p) => h.phases.push(p), new AbortController().signal, options);
}

describe("runCheckIn", () => {
  it("sends, waits for the block and lands the stamp", async () => {
    const h = harness([submitted], [tx("pending"), tx("pending"), tx("success")]);
    const final = await run(h);
    expect(h.phases.map((p) => p.kind)).toEqual(["sending", "confirming", "stamped"]);
    expect(final).toMatchObject({ kind: "stamped", txHash: TX, blockNumber: "10" });
    expect(h.waits).toEqual([700, 700]);
    expect(h.outbox).toEqual({ saved: 1, removed: 1 });
  });

  it("treats already checked in as the stamp they have, not an error", async () => {
    const h = harness([fail(apiError(422, "already_present"))]);
    expect(await run(h)).toEqual({ kind: "already" });
    expect(h.outbox.removed).toBe(1);
  });

  it.each([
    ["stale", "stale"],
    ["at_capacity", "capacity"],
    ["outside_event_window", "window"],
    ["bad_door_sig", "rejected"],
  ] as const)("stops on %s without retrying and keeps the API's words", async (code, kind) => {
    const h = harness([fail(apiError(422, code))]);
    const final = await run(h);
    expect(final).toEqual({
      kind: "failed",
      problem: { kind, code, message: `${code} message`, action: `${code} action`, retryable: false },
    });
    expect(h.deps.postCheckIn).toHaveBeenCalledTimes(1);
    expect(h.outbox.removed).toBe(1);
  });

  it("keeps the signed check-in and retries with backoff while the relay is down", async () => {
    const h = harness([fail(apiError(503, "upstream_unavailable")), fail({ kind: "network", code: "network" }), fail(apiError(504, "relay_timeout")), submitted]);
    const final = await run(h);
    expect(final?.kind).toBe("stamped");
    expect(h.deps.postCheckIn).toHaveBeenCalledTimes(4);
    expect(h.waits.slice(0, 3)).toEqual([1_000, 2_000, 4_000]);
    const waiting = h.phases.filter((p) => p.kind === "waiting");
    expect(waiting).toHaveLength(3);
    expect(waiting[0]).toMatchObject({ problem: { kind: "relay", code: "upstream_unavailable" }, retryAt: 1_001_000 });
    // Saved before the first attempt and cleared only once the relayer accepted it.
    expect(h.outbox).toEqual({ saved: 1, removed: 1 });
  });

  it("waits for the phone to come back online instead of polling", async () => {
    const h = harness([fail({ kind: "network", code: "network" }), submitted], [tx("success")], false);
    await run(h);
    expect(h.waits[0]).toBeNull();
    expect(h.phases[1]).toMatchObject({ kind: "waiting", problem: { kind: "offline" }, retryAt: null });
  });

  it("gives up after the last attempt but leaves the check-in saved for later", async () => {
    const h = harness([], [], true);
    const final = await run(h, { maxAttempts: 3, pollMs: 700, confirmTimeoutMs: 45_000 });
    expect(final).toMatchObject({ kind: "failed", problem: { kind: "relay", retryable: true } });
    expect(h.deps.postCheckIn).toHaveBeenCalledTimes(3);
    expect(h.outbox.removed).toBe(0);
  });

  it("reports a reverted transaction", async () => {
    const h = harness([submitted], [tx("reverted")]);
    expect(await run(h)).toMatchObject({ kind: "failed", problem: { kind: "reverted" }, txHash: TX });
  });

  it("says the network is slow, with the transaction, when no block confirms in time", async () => {
    const h = harness([submitted], []);
    const final = await run(h, { maxAttempts: 5, pollMs: 10_000, confirmTimeoutMs: 30_000 });
    expect(final).toMatchObject({ kind: "failed", problem: { kind: "unconfirmed" }, txHash: TX });
  });

  it("keeps polling through a failed status read", async () => {
    const h = harness([submitted], [fail({ kind: "network", code: "network" }), tx("success")]);
    expect((await run(h))?.kind).toBe("stamped");
  });

  it("stops quietly when the screen goes away", async () => {
    const h = harness([fail(apiError(503, "upstream_unavailable"))]);
    const controller = new AbortController();
    h.deps.wait = async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    };
    const final = await runCheckIn(request, h.deps, (p) => h.phases.push(p), controller.signal);
    expect(final).toBeNull();
    expect(h.phases.at(-1)?.kind).toBe("waiting");
  });
});

describe("classifyFailure", () => {
  it("splits temporary trouble from final answers", () => {
    expect(classifyFailure(apiError(429, "rate_limited"), true).kind).toBe("rate");
    expect(classifyFailure(apiError(503, "relayer_not_configured"), true)).toMatchObject({ kind: "relay", retryable: true });
    expect(classifyFailure(apiError(500, "http_500"), true).retryable).toBe(true);
    expect(classifyFailure({ kind: "malformed", code: "malformed" }, true).kind).toBe("relay");
    expect(classifyFailure({ kind: "timeout", code: "timeout" }, false).kind).toBe("offline");
    expect(classifyFailure(apiError(400, "invalid_request"), true)).toMatchObject({ kind: "rejected", retryable: false });
  });

  it("backs off quickly, then every 15 seconds, and sits out rate limits", () => {
    const relay = classifyFailure(apiError(503, "upstream_unavailable"), true);
    expect([1, 2, 3, 4, 5, 9].map((n) => retryDelayMs(relay, n))).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    expect(retryDelayMs(classifyFailure(apiError(429, "rate_limited"), true), 1)).toBe(20_000);
  });
});

describe("createWaiter", () => {
  it("wakes every pending wait early", async () => {
    const waiter = createWaiter();
    const signal = new AbortController().signal;
    const waits = [waiter.wait(60_000, signal), waiter.wait(null, signal)];
    waiter.wake();
    await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
  });

  it("rejects when aborted", async () => {
    const waiter = createWaiter();
    const controller = new AbortController();
    const waiting = waiter.wait(null, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("Aborted");
  });
});
