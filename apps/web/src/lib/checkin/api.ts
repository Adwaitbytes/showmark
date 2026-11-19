import type { Hex } from "viem";
import type { CheckInRequest } from "./sign";

// Typed client for the /api routes the check-in screen calls. Kept to the check-in path on purpose:
// this module ships in the /c/[token] bundle, so passport and wallet routes live in api-passport.ts.
// Every response is validated before it reaches the UI. The guards here are written by hand because
// zod costs about 23 kB gzipped on the door route; api-passport.ts, loaded later, uses zod/mini.

export type FailureKind = "api" | "network" | "timeout" | "malformed";

export interface ApiFailure {
  kind: FailureKind;
  /** HTTP status for kind "api". */
  status?: number;
  /** The API's error code, or a local one: "network", "timeout", "malformed". */
  code: string;
  /** The API's own message and action, when it sent them. */
  message?: string;
  action?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Turns an unknown JSON body into T, or null when it does not have the expected shape. */
export type Parser<T> = (body: unknown) => T | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isHex = (value: unknown): value is Hex => isString(value) && /^0x[0-9a-fA-F]+$/.test(value);
const isDigits = (value: unknown): value is string => isString(value) && /^\d+$/.test(value);

function parseApiError(body: unknown): { code: string; message: string; action: string } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, message, action } = body.error;
  return isString(code) && isString(message) && isString(action) ? { code, message, action } : null;
}

export interface RequestOptions {
  fetch?: Fetcher;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Let the request finish even if the page is closed or navigates away (the check-in POST). */
  keepalive?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** One request with a timeout, the error shape decoded, and the body validated. Never throws. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit,
  parse: Parser<T>,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetcher(path, { ...init, keepalive: options.keepalive, signal: controller.signal, headers: { accept: "application/json", ...init.headers } });
    } catch {
      return { ok: false, failure: timedOut ? { kind: "timeout", code: "timeout" } : { kind: "network", code: "network" } };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = parseApiError(body);
      return {
        ok: false,
        failure: error ? { kind: "api", status: response.status, ...error } : { kind: "api", status: response.status, code: `http_${response.status}` },
      };
    }
    const data = parse(body);
    return data === null ? { ok: false, failure: { kind: "malformed", code: "malformed" } } : { ok: true, data };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** A JSON POST body. */
export function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// ------------------------------------------------------------------------------------------- relay

export interface Submitted {
  txHash: Hex;
  status: "submitted";
}

/** The relay accepted the check-in but had no hash within its 3 s budget (202). Poll by id. */
export interface Queued {
  id: string;
  status: "queued";
}

export type RelayAnswer = Submitted | Queued;

export const parseSubmitted: Parser<Submitted> = (body) =>
  isRecord(body) && isHex(body.txHash) && body.txHash.length === 66 && body.status === "submitted" ? { txHash: body.txHash, status: "submitted" } : null;

export const parseRelayAnswer: Parser<RelayAnswer> = (body) => {
  if (isRecord(body) && body.status === "queued" && isString(body.id) && /^[0-9a-f]{24}$/.test(body.id)) return { id: body.id, status: "queued" };
  return parseSubmitted(body);
};

export function postCheckIn(request: CheckInRequest, options?: RequestOptions): Promise<ApiResult<RelayAnswer>> {
  // keepalive: a check-in already signed should still reach the relay if the person locks the phone.
  // 6 s: the chain is watched in parallel, so a lost response is retried rather than waited out.
  return apiRequest("/api/relay/check-in", postJson(request), parseRelayAnswer, { keepalive: true, timeoutMs: 6_000, ...options });
}

/** Where a queued check-in is: still queued (202), broadcast (200), or rejected (422 with the usual copy). */
export function getQueuedCheckIn(id: string, options?: RequestOptions): Promise<ApiResult<RelayAnswer>> {
  return apiRequest(`/api/relay/check-in/${encodeURIComponent(id)}`, { method: "GET", cache: "no-store" }, parseRelayAnswer, { timeoutMs: 6_000, ...options });
}

export interface TxState {
  status: "pending" | "success" | "reverted";
  blockNumber?: string;
  /** This attendee's own result inside a mined batch, when the API was asked about them. */
  checkIn?: { recorded: boolean; error?: { code: string; message: string; action: string } };
}

export const parseTxState: Parser<TxState> = (body) => {
  if (!isRecord(body)) return null;
  const { status, blockNumber, checkIn } = body;
  if (status !== "pending" && status !== "success" && status !== "reverted") return null;
  if (blockNumber !== undefined && !isDigits(blockNumber)) return null;
  const state: TxState = blockNumber === undefined ? { status } : { status, blockNumber };
  if (isRecord(checkIn) && typeof checkIn.recorded === "boolean") {
    const error = parseApiError({ error: checkIn.error });
    state.checkIn = error ? { recorded: checkIn.recorded, error } : { recorded: checkIn.recorded };
  }
  return state;
};

/** Receipt status. With `who`, the API also says whether this attendee's item in the batch was recorded. */
export function getTxStatus(hash: Hex, options?: RequestOptions, who?: { eventId: string; attendee: string }): Promise<ApiResult<TxState>> {
  const query = who ? `?event=${encodeURIComponent(who.eventId)}&attendee=${encodeURIComponent(who.attendee)}` : "";
  return apiRequest(`/api/tx/${hash}${query}`, { method: "GET", cache: "no-store" }, parseTxState, { timeoutMs: 8_000, ...options });
}

// ------------------------------------------------------------------------------------------- event

export interface CampaignPayingBrief {
  id: string;
  name: string;
  sponsorName: string;
  tokenSymbol: "QIE" | "QUSDC";
  attendeeAmount: string;
  requireQieId: boolean;
  minProofMode: 1 | 2;
}

/** The parts of EventDetail (src/lib/api/types.ts) the attendee screens read. */
export interface CheckInEvent {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  checkedIn: number;
  metadata: { name: string; venue: string; city: string };
  campaigns: CampaignPayingBrief[];
}

function parseCampaign(value: unknown): CampaignPayingBrief | null {
  if (!isRecord(value)) return null;
  const { id, name, sponsorName, tokenSymbol, attendeeAmount, requireQieId, minProofMode } = value;
  if (!isString(id) || !isString(name) || !isString(sponsorName) || !isDigits(attendeeAmount) || typeof requireQieId !== "boolean") return null;
  if (tokenSymbol !== "QIE" && tokenSymbol !== "QUSDC") return null;
  if (minProofMode !== 1 && minProofMode !== 2) return null;
  return { id, name, sponsorName, tokenSymbol, attendeeAmount, requireQieId, minProofMode };
}

export const parseEvent: Parser<CheckInEvent> = (body) => {
  if (!isRecord(body) || !isRecord(body.metadata) || !Array.isArray(body.campaigns)) return null;
  const { id, startsAt, endsAt, capacity, checkedIn } = body;
  const { name, venue, city } = body.metadata;
  if (!isString(id) || !isString(startsAt) || !isString(endsAt) || typeof capacity !== "number" || typeof checkedIn !== "number") return null;
  if (!isString(name) || !isString(venue) || !isString(city)) return null;
  const campaigns = body.campaigns.map(parseCampaign);
  if (campaigns.some((c) => c === null)) return null;
  return { id, startsAt, endsAt, capacity, checkedIn, metadata: { name, venue, city }, campaigns: campaigns.filter((c) => c !== null) };
};

export function getEvent(id: string, options?: RequestOptions): Promise<ApiResult<CheckInEvent>> {
  return apiRequest(`/api/events/${encodeURIComponent(id)}`, { method: "GET" }, parseEvent, options);
}
