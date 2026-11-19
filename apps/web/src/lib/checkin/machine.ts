import type { Hex } from "viem";
import type { ApiResult, Submitted, TxState } from "./api";
import { classifyFailure, retryDelayMs, type CheckInProblem } from "./errors";
import type { CheckInRequest } from "./sign";

/**
 * The check-in as a sequence of phases. The screen renders whichever phase it is told about; this
 * module decides what happens next. It is plain async code with every side effect injected, so the
 * tests drive it through outages, rejections and slow blocks without a browser.
 *
 *   sending -> confirming -> stamped
 *      |  \-> already                      (one presence per event: show the stamp they have)
 *      |  \-> failed                       (final: stale code, full event, window closed, rejected)
 *      \-> waiting -> sending ...          (offline, relay down, rate limited: the signed check-in is kept)
 *
 * In parallel, from the first send, the chain itself is asked every second whether presence is
 * recorded. Whichever answers first wins: a relay hash with a mined receipt, or presence on chain
 * (then the stamp shows without a hash until the screen finds the transaction). A lost or slow HTTP
 * response therefore never costs more than about a second.
 */
export type CheckInPhase =
  | { kind: "sending"; attempt: number }
  | {
      kind: "waiting";
      problem: CheckInProblem;
      attempt: number;
      /** When the next attempt starts (ms since epoch), or null while waiting to come back online. */
      retryAt: number | null;
    }
  | { kind: "confirming"; txHash: Hex; since: number }
  | { kind: "stamped"; txHash: Hex | null; at: number; blockNumber?: string }
  | { kind: "already" }
  | { kind: "failed"; problem: CheckInProblem; txHash?: Hex };

export interface CheckInDeps {
  postCheckIn(request: CheckInRequest, signal: AbortSignal): Promise<ApiResult<Submitted>>;
  txStatus(hash: Hex, signal: AbortSignal): Promise<ApiResult<TxState>>;
  now(): number;
  isOnline(): boolean;
  /** Resolves after `ms`, or when woken early (a "try now" tap, the phone coming online). `null` waits only for a wake. */
  wait(ms: number | null, signal: AbortSignal): Promise<void>;
  /** Keeps the signed check-in on the phone until the relay has it. */
  outbox?: { save(request: CheckInRequest): void; remove(request: CheckInRequest): void };
  /** Asks the chain whether presence is recorded: true, false, or null when it cannot be read. */
  presence?(request: CheckInRequest, signal: AbortSignal): Promise<boolean | null>;
}

export interface CheckInOptions {
  /** Send attempts before giving up and asking the person to try again by hand. */
  maxAttempts: number;
  /** How often to ask whether the transaction is mined. QIE blocks are about 3.6 s. */
  pollMs: number;
  /** How long to wait for the transaction before saying it is slow. */
  confirmTimeoutMs: number;
  /** How often to ask the chain directly whether presence is recorded. */
  presencePollMs: number;
}

export const DEFAULT_CHECK_IN_OPTIONS: CheckInOptions = { maxAttempts: 20, pollMs: 700, confirmTimeoutMs: 45_000, presencePollMs: 1_000 };

/** Runs one signed check-in to a final phase and returns it. Stops quietly when `signal` aborts. */
export async function runCheckIn(
  request: CheckInRequest,
  deps: CheckInDeps,
  emit: (phase: CheckInPhase) => void,
  signal: AbortSignal,
  options: CheckInOptions = DEFAULT_CHECK_IN_OPTIONS,
): Promise<CheckInPhase | null> {
  if (!deps.presence) return runThroughRelay(request, deps, emit, signal, options);

  const inner = new AbortController();
  const stop = () => inner.abort();
  signal.addEventListener("abort", stop, { once: true });
  let settled = false;
  const guarded = (phase: CheckInPhase) => {
    if (!settled) emit(phase);
  };
  try {
    const relay = runThroughRelay(request, deps, guarded, inner.signal, options).then((phase) => ({ from: "relay" as const, phase }));
    const chain = watchPresence(request, deps, inner.signal, options).then((recorded) => ({ from: "chain" as const, recorded }));
    const first = await Promise.race([relay, chain]);
    if (first.from === "relay") return first.phase;
    if (!first.recorded || signal.aborted) return relay.then((r) => r.phase);
    settled = true;
    deps.outbox?.remove(request);
    const phase: CheckInPhase = { kind: "stamped", txHash: null, at: deps.now() };
    emit(phase);
    return phase;
  } finally {
    inner.abort();
    signal.removeEventListener("abort", stop);
  }
}

/** Polls the chain until presence is recorded (true) or the run stops (null). */
async function watchPresence(request: CheckInRequest, deps: CheckInDeps, signal: AbortSignal, options: CheckInOptions): Promise<boolean | null> {
  while (!signal.aborted) {
    try {
      await deps.wait(options.presencePollMs, signal);
    } catch {
      return null;
    }
    const recorded = await deps.presence?.(request, signal);
    if (signal.aborted) return null;
    if (recorded) return true;
  }
  return null;
}

async function runThroughRelay(
  request: CheckInRequest,
  deps: CheckInDeps,
  emit: (phase: CheckInPhase) => void,
  signal: AbortSignal,
  options: CheckInOptions = DEFAULT_CHECK_IN_OPTIONS,
): Promise<CheckInPhase | null> {
  const finish = (phase: CheckInPhase): CheckInPhase | null => {
    if (signal.aborted) return null;
    emit(phase);
    return phase;
  };

  deps.outbox?.save(request);
  let submitted: Submitted | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (signal.aborted) return null;
    emit({ kind: "sending", attempt });
    const result = await deps.postCheckIn(request, signal);
    if (signal.aborted) return null;
    if (result.ok) {
      submitted = result.data;
      break;
    }
    const problem = classifyFailure(result.failure, deps.isOnline());
    if (problem.kind === "already") {
      deps.outbox?.remove(request);
      return finish({ kind: "already" });
    }
    if (!problem.retryable) {
      deps.outbox?.remove(request);
      return finish({ kind: "failed", problem });
    }
    if (attempt === options.maxAttempts) return finish({ kind: "failed", problem });

    const delay = problem.kind === "offline" ? null : retryDelayMs(problem, attempt);
    emit({ kind: "waiting", problem, attempt, retryAt: delay === null ? null : deps.now() + delay });
    try {
      await deps.wait(delay, signal);
    } catch {
      return null;
    }
  }

  if (!submitted) return null;
  // The relayer holds it now; a resend would only come back as "already present".
  deps.outbox?.remove(request);
  return confirm(submitted.txHash, deps, finish, emit, signal, options);
}

async function confirm(
  txHash: Hex,
  deps: CheckInDeps,
  finish: (phase: CheckInPhase) => CheckInPhase | null,
  emit: (phase: CheckInPhase) => void,
  signal: AbortSignal,
  options: CheckInOptions,
): Promise<CheckInPhase | null> {
  const since = deps.now();
  emit({ kind: "confirming", txHash, since });
  const deadline = since + options.confirmTimeoutMs;

  while (deps.now() < deadline) {
    const status = await deps.txStatus(txHash, signal);
    if (signal.aborted) return null;
    // A failed status read is not a failed check-in: keep asking until the deadline.
    if (status.ok && status.data.status === "success") {
      return finish({ kind: "stamped", txHash, at: deps.now(), blockNumber: status.data.blockNumber });
    }
    if (status.ok && status.data.status === "reverted") {
      return finish({ kind: "failed", problem: { kind: "reverted", code: "reverted", retryable: false }, txHash });
    }
    try {
      await deps.wait(options.pollMs, signal);
    } catch {
      return null;
    }
  }
  return finish({ kind: "failed", problem: { kind: "unconfirmed", code: "unconfirmed", retryable: false }, txHash });
}

/**
 * A sleep that can be cut short. The screen calls `wake()` when the person taps "Try now" or the
 * phone comes back online, so a waiting check-in goes out at once instead of at its next slot.
 */
export function createWaiter(): { wait: CheckInDeps["wait"]; wake: () => void } {
  let wakers = new Set<() => void>();
  return {
    wait(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const done = () => {
          if (timer !== null) clearTimeout(timer);
          wakers.delete(done);
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          if (timer !== null) clearTimeout(timer);
          wakers.delete(done);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = ms === null ? null : setTimeout(done, ms);
        wakers.add(done);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    wake() {
      const pending = wakers;
      wakers = new Set();
      for (const done of pending) done();
    },
  };
}
