import type { ApiFailure } from "./api";

/**
 * What went wrong with a check-in, in the terms the screen acts on.
 *
 * - already: not an error. The person has a stamp for this event; show it.
 * - stale, capacity, window, rejected: final. The signed check-in can never succeed as it is.
 * - offline, relay, rate: temporary. Keep the signed check-in and send it again.
 */
export type ProblemKind =
  | "already"
  | "stale"
  | "capacity"
  | "window"
  | "rejected"
  | "offline"
  | "relay"
  | "rate"
  | "invalid"
  | "storage"
  | "reverted"
  | "unconfirmed";

export interface CheckInProblem {
  kind: ProblemKind;
  /** The API's error code, or a local one. Used to pick translated copy. */
  code: string;
  /** The API's message and action, shown verbatim in English. */
  message?: string;
  action?: string;
  retryable: boolean;
}

const FINAL_CODES: Readonly<Record<string, ProblemKind>> = {
  already_present: "already",
  stale: "stale",
  at_capacity: "capacity",
  outside_event_window: "window",
};

/** Codes for server trouble that a later attempt can get past. */
const TEMPORARY_CODES = new Set([
  "relay_timeout",
  "relay_send_failed",
  "upstream_unavailable",
  "internal_error",
  "database_not_configured",
  "queue_not_configured",
  "redis_not_configured",
  "relayer_not_configured",
]);

export function classifyFailure(failure: ApiFailure, online: boolean): CheckInProblem {
  const copy = { code: failure.code, message: failure.message, action: failure.action };
  if (failure.kind === "network" || failure.kind === "timeout") {
    return online ? { kind: "relay", ...copy, retryable: true } : { kind: "offline", code: "offline", retryable: true };
  }
  if (failure.kind === "malformed") return { kind: "relay", ...copy, retryable: true };

  const final = FINAL_CODES[failure.code];
  if (final) return { kind: final, ...copy, retryable: false };
  const status = failure.status ?? 0;
  if (status === 429) return { kind: "rate", ...copy, retryable: true };
  if (status >= 500 || TEMPORARY_CODES.has(failure.code)) return { kind: "relay", ...copy, retryable: true };
  return { kind: "rejected", ...copy, retryable: false };
}

/** Waits between attempts: quick at first, then every 15 s. Rate limits wait out most of their minute. */
export function retryDelayMs(problem: CheckInProblem, attempt: number): number {
  if (problem.kind === "rate") return 20_000;
  const steps = [1_000, 2_000, 4_000, 8_000];
  return steps[attempt - 1] ?? 15_000;
}
