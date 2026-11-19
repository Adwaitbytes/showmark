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

async function post<T>(fetchImpl: FetchLike, path: string, body: unknown, parse: (json: unknown) => T | null): Promise<RelayOutcome<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
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
    const value = parse(json);
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

export function submitAttestation(item: SignedAttestation, fetchImpl: FetchLike = browserFetch): Promise<RelayOutcome<{ txHash: Hex }>> {
  return post(fetchImpl, "/api/relay/check-in", item, (json) => {
    const tx = (json as { txHash?: unknown } | null)?.txHash;
    return isTxHash(tx) ? { txHash: tx } : null;
  });
}

export function submitAttestationBatch(
  items: readonly SignedAttestation[],
  fetchImpl: FetchLike = browserFetch,
): Promise<RelayOutcome<{ txHash: Hex; accepted: number }>> {
  if (items.length === 0 || items.length > MAX_BATCH) {
    throw new RangeError(`A batch holds 1 to ${MAX_BATCH} check-ins, got ${items.length}`);
  }
  return post(fetchImpl, "/api/relay/check-in/batch", { items }, (json) => {
    const body = json as { txHash?: unknown; accepted?: unknown } | null;
    return body && isTxHash(body.txHash) && typeof body.accepted === "number" ? { txHash: body.txHash, accepted: body.accepted } : null;
  });
}
