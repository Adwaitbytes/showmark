import * as z from "zod/mini";
import type { Hex } from "viem";
import type { CheckInRequest } from "./sign";

// Typed client for the /api routes the check-in screen calls. Kept to the check-in path on purpose:
// this module ships in the /c/[token] bundle, so passport and wallet routes live in api-passport.ts.
// Responses are validated with zod/mini (a few kB) because a malformed body must never reach the UI.

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

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), action: z.string() }),
});

const hexSchema = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value));
const digitsSchema = z.string().check(z.regex(/^\d+$/));

export interface RequestOptions {
  fetch?: Fetcher;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** One request with a timeout, the error shape decoded, and the body validated. Never throws. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodMiniType<T>,
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
      response = await fetcher(path, { ...init, signal: controller.signal, headers: { accept: "application/json", ...init.headers } });
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
      const parsed = apiErrorSchema.safeParse(body);
      return {
        ok: false,
        failure: parsed.success
          ? { kind: "api", status: response.status, ...parsed.data.error }
          : { kind: "api", status: response.status, code: `http_${response.status}` },
      };
    }
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, failure: { kind: "malformed", code: "malformed" } };
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

const submittedSchema = z.object({ txHash: hexSchema, status: z.literal("submitted") });
export type Submitted = z.infer<typeof submittedSchema>;

export function postCheckIn(request: CheckInRequest, options?: RequestOptions): Promise<ApiResult<Submitted>> {
  return apiRequest("/api/relay/check-in", postJson(request), submittedSchema, options);
}

const txStatusSchema = z.object({
  status: z.enum(["pending", "success", "reverted"]),
  blockNumber: z.optional(z.string()),
});
export type TxState = z.infer<typeof txStatusSchema>;

export function getTxStatus(hash: Hex, options?: RequestOptions): Promise<ApiResult<TxState>> {
  return apiRequest(`/api/tx/${hash}`, { method: "GET", cache: "no-store" }, txStatusSchema, { timeoutMs: 8_000, ...options });
}

// ------------------------------------------------------------------------------------------- event

const campaignPayingSchema = z.object({
  id: z.string(),
  name: z.string(),
  sponsorName: z.string(),
  tokenSymbol: z.enum(["QIE", "QUSDC"]),
  attendeeAmount: digitsSchema,
  requireQieId: z.boolean(),
  minProofMode: z.union([z.literal(1), z.literal(2)]),
});

const eventSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number(),
  checkedIn: z.number(),
  metadata: z.object({ name: z.string(), venue: z.string(), city: z.string() }),
  campaigns: z.array(campaignPayingSchema),
});

/** The parts of EventDetail (src/lib/api/types.ts) the attendee screens read. */
export type CheckInEvent = z.infer<typeof eventSchema>;

export function getEvent(id: string, options?: RequestOptions): Promise<ApiResult<CheckInEvent>> {
  return apiRequest(`/api/events/${encodeURIComponent(id)}`, { method: "GET" }, eventSchema, options);
}
