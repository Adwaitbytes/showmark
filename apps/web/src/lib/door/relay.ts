import type { ApiError, Hex } from "@/lib/api/types";
import type { SignedAttestation } from "./sign";

// Client for the two relay routes the door uses in mode 2. Every outcome is a value, never a throw, because the
// scanner has to decide between "done", "queue it for later" and "tell the staff member why it failed".

export const MAX_BATCH = 50;

export interface ErrorCopy {
  code: string;
  message: string;
  action: string;
}

export type RelayOutcome<T> =
  | { kind: "ok"; value: T }
  /** No connection, a timeout or a server that is temporarily unable to help. Keep the item and retry later. */
  | { kind: "retry"; error: ErrorCopy }
  /** The relayer looked at it and said no. Retrying the same item will not help. */
  | { kind: "rejected"; status: number; error: ErrorCopy };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const browserFetch: FetchLike = (input, init) => fetch(input, init);

const OFFLINE: ErrorCopy = {
  code: "offline",
  message: "This device could not reach Showmark.",
  action: "The check-in is saved on this device and is sent as soon as the connection is back.",
};

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const e = (value as { error: unknown }).error;
  if (typeof e !== "object" || e === null) return false;
  const { code, message, action } = e as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string" && typeof action === "string";
}

function fallbackCopy(status: number): ErrorCopy {
  if (status >= 500 || status === 429) {
    return {
      code: `http_${status}`,
      message: "Showmark could not take this check-in right now.",
      action: "It is saved on this device and is sent again automatically.",
    };
  }
  return {
    code: `http_${status}`,
    message: "Showmark did not accept this check-in.",
    action: "Ask the attendee to reopen their code and scan it again.",
  };
}

/** 408, 425, 429 and every 5xx are worth retrying; other 4xx answers are final. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function request<T>(
  fetchImpl: FetchLike,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  parse: (json: unknown, status: number) => T | null,
): Promise<RelayOutcome<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: init.method,
      headers: init.body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { kind: "retry", error: OFFLINE };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (response.ok) {
    const value = parse(json, response.status);
    if (value !== null) return { kind: "ok", value };
    return { kind: "retry", error: fallbackCopy(502) };
  }
  const error = isApiError(json) ? json.error : fallbackCopy(response.status);
  if (isRetryableStatus(response.status)) return { kind: "retry", error };
  return { kind: "rejected", status: response.status, error };
}

function isTxHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * The relayer either broadcast the check-in (a transaction hash) or, under load, accepted it into its queue and
 * answered 202 with an id to poll. Both mean the check-in is in the relayer's hands; neither belongs in the offline
 * queue.
 */
export type CheckInAnswer = { sent: true; txHash: Hex } | { sent: false; queuedId: string };

function parseCheckInAnswer(json: unknown, status: number): CheckInAnswer | null {
  const body = json as { txHash?: unknown; status?: unknown; id?: unknown } | null;
  if (body && isTxHash(body.txHash)) return { sent: true, txHash: body.txHash };
  if (status === 202 && body?.status === "queued" && typeof body.id === "string" && /^[0-9a-f]{8,64}$/.test(body.id)) {
    return { sent: false, queuedId: body.id };
  }
  return null;
}

export function submitAttestation(item: SignedAttestation, fetchImpl: FetchLike = browserFetch): Promise<RelayOutcome<CheckInAnswer>> {
  return request(fetchImpl, "/api/relay/check-in", { method: "POST", body: item }, parseCheckInAnswer);
}

/** Asks what became of a check-in the relayer queued. 202 means still queued; results are kept for 10 minutes. */
export function pollAttestation(id: string, fetchImpl: FetchLike = browserFetch): Promise<RelayOutcome<CheckInAnswer>> {
  return request(fetchImpl, `/api/relay/check-in/${encodeURIComponent(id)}`, { method: "GET" }, parseCheckInAnswer);
}

export interface BatchAnswer {
  /** The checkInBatch transaction, or null when nothing in the batch needed sending. */
  txHash: Hex | null;
  accepted: number;
  /** Items the relayer did not send, by position in the request, with copy. */
  rejected: ({ index: number } & ErrorCopy)[];
}

function parseRejected(value: unknown): BatchAnswer["rejected"] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: BatchAnswer["rejected"] = [];
  for (const r of value) {
    const e = r as Partial<{ index: unknown; code: unknown; message: unknown; action: unknown }>;
    if (typeof e.index !== "number" || typeof e.code !== "string" || typeof e.message !== "string" || typeof e.action !== "string") return null;
    out.push({ index: e.index, code: e.code, message: e.message, action: e.action });
  }
  return out;
}

export function submitAttestationBatch(items: readonly SignedAttestation[], fetchImpl: FetchLike = browserFetch): Promise<RelayOutcome<BatchAnswer>> {
  if (items.length === 0 || items.length > MAX_BATCH) {
    throw new RangeError(`A batch holds 1 to ${MAX_BATCH} check-ins, got ${items.length}`);
  }
  return request(fetchImpl, "/api/relay/check-in/batch", { method: "POST", body: { items } }, (json) => {
    const body = json as { txHash?: unknown; accepted?: unknown; rejected?: unknown } | null;
    if (!body || typeof body.accepted !== "number" || (body.txHash !== null && !isTxHash(body.txHash))) return null;
    const rejected = parseRejected(body.rejected);
    return rejected === null ? null : { txHash: body.txHash ?? null, accepted: body.accepted, rejected };
  });
}
