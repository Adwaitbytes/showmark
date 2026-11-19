import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { Address, EventDetail, EventSummary, Hex, Passport, Session } from "@/lib/api/types";

// Typed reads from the Showmark API for the organizer console. Every response is parsed with zod before it reaches a
// component, so a backend change shows up as a clear error state instead of a broken screen.

export interface ErrorCopy {
  code: string;
  message: string;
  action: string;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly copy: ErrorCopy,
  ) {
    super(copy.message);
    this.name = "ApiRequestError";
  }
}

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "address")
  .transform((v): Address => getAddress(v));
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((v) => v as Hex);
const decimal = z.string().regex(/^\d+$/);
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "timestamp");

const metadataSchema = z.object({
  v: z.literal(1),
  name: z.string(),
  venue: z.string(),
  city: z.string(),
  description: z.string(),
  url: z.string().optional(),
});

const eventSummarySchema = z.object({
  id: decimal,
  organizer: address,
  organizerName: z.string().nullable(),
  startsAt: iso,
  endsAt: iso,
  capacity: z.number().int().nonnegative(),
  checkedIn: z.number().int().nonnegative(),
  maxPassAge: z.number().int().nonnegative(),
  seriesId: decimal,
  seriesIndex: z.number().int().nonnegative(),
  metadata: metadataSchema,
  createdTx: hex,
}) satisfies z.ZodType<EventSummary>;

const campaignPayingSchema = z.object({
  id: decimal,
  name: z.string(),
  sponsorName: z.string(),
  token: address,
  tokenSymbol: z.enum(["QIE", "QUSDC"]),
  attendeeAmount: decimal,
  requireQieId: z.boolean(),
  minProofMode: z.union([z.literal(1), z.literal(2)]),
});

const eventDetailSchema = eventSummarySchema.extend({
  campaigns: z.array(campaignPayingSchema),
  recentCheckIns: z.array(
    z.object({
      attendee: address,
      name: z.string().nullable(),
      at: iso,
      tx: hex,
      mode: z.union([z.literal(1), z.literal(2)]),
    }),
  ),
}) satisfies z.ZodType<EventDetail>;

// The list route may answer with a bare array or wrapped in { events }; both carry the same items.
const eventListSchema = z.union([z.array(eventSummarySchema), z.object({ events: z.array(eventSummarySchema) }).transform((v) => v.events)]);

const sessionSchema = z.object({
  address,
  qieName: z.string().nullable(),
  expiresAt: iso,
}) satisfies z.ZodType<Session>;

const passportNameSchema = z.object({ qieName: z.string().nullable() }).passthrough();

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), action: z.string() }) });

export const OFFLINE_COPY: ErrorCopy = {
  code: "offline",
  message: "This device could not reach Showmark.",
  action: "Check the internet connection, then try again.",
};

const UNEXPECTED_COPY: ErrorCopy = {
  code: "unexpected_response",
  message: "Showmark sent back something this page did not expect.",
  action: "Reload the page. If it keeps happening, tell the Showmark team.",
};

function copyForStatus(status: number): ErrorCopy {
  if (status === 404) return { code: "not_found", message: "Showmark has no record of this.", action: "Check the link and try again." };
  if (status === 401) return { code: "unauthorized", message: "You are not signed in, or your session ended.", action: "Sign in with QIE Wallet and try again." };
  if (status >= 500) return { code: `http_${status}`, message: "Showmark could not answer just now.", action: "Try again in a few seconds." };
  return { code: `http_${status}`, message: "Showmark could not handle this request.", action: "Reload the page and try again." };
}

export async function requestJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiRequestError(0, OFFLINE_COPY);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error : copyForStatus(response.status));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiRequestError(response.status, UNEXPECTED_COPY);
  return parsed.data;
}

export function errorCopy(error: unknown): ErrorCopy {
  if (error instanceof ApiRequestError) return error.copy;
  return UNEXPECTED_COPY;
}

export const api = {
  organizerEvents: (organizer: Address) => requestJson(`/api/events?organizer=${organizer}&limit=100`, eventListSchema),
  event: (id: string) => requestJson(`/api/events/${encodeURIComponent(id)}`, eventDetailSchema),
  /** The .qie name for an address, from its public passport. Null when it has none or nothing is recorded yet. */
  async qieName(account: Address): Promise<string | null> {
    try {
      const passport = await requestJson(`/api/passport/${account}`, passportNameSchema);
      return (passport as Pick<Passport, "qieName">).qieName;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  },
  /** Just the token of a campaign, to label payouts read from the chain. */
  campaignToken: (id: string) =>
    requestJson(`/api/campaigns/${encodeURIComponent(id)}`, z.object({ tokenSymbol: z.enum(["QIE", "QUSDC"]), name: z.string() }).passthrough()),
  session: () => requestJson("/api/auth/session", sessionSchema),
  /** The server writes the exact sign-in message, bound to this address and a single-use nonce. */
  challenge: (address: Address) =>
    requestJson(`/api/auth/nonce?address=${address}`, z.object({ nonce: z.string().min(8), message: z.string().min(1) }), { method: "GET" }),
  verify: (message: string, signature: Hex) =>
    requestJson("/api/auth/verify", sessionSchema, { method: "POST", body: JSON.stringify({ message, signature }) }),
  signOut: () => requestJson("/api/auth/session", z.unknown(), { method: "DELETE" }),
};
