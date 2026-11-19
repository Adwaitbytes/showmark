import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { Address, CampaignDetail, CampaignSummary, EventSummary, Hex, Session, Settlement } from "@/lib/api/types";
import type { PlainError } from "./errors";

// Typed, validated reads of the /api routes the sponsor console uses (INTERFACES section 3). Responses are checked
// at this boundary so a shape change in the API shows a clear error instead of a broken screen.

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "address")
  .transform((v): Address => getAddress(v));
const hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/)
  .transform((v): Hex => v as Hex);
const uintString = z.string().regex(/^\d+$/);
const iso = z.string().refine((v) => Number.isFinite(Date.parse(v)), "timestamp");
const tokenSymbol = z.enum(["QIE", "QUSDC"]);
const mode = z.union([z.literal(1), z.literal(2)]);

export const eventSummarySchema = z.object({
  id: uintString,
  organizer: address,
  organizerName: z.string().nullable(),
  startsAt: iso,
  endsAt: iso,
  capacity: z.number().int(),
  checkedIn: z.number().int(),
  maxPassAge: z.number().int(),
  seriesId: uintString,
  seriesIndex: z.number().int(),
  metadata: z.object({
    v: z.literal(1),
    name: z.string(),
    venue: z.string(),
    city: z.string(),
    description: z.string(),
    url: z.string().optional(),
  }),
  createdTx: hex,
}) satisfies z.ZodType<EventSummary>;

export const campaignSummarySchema = z.object({
  id: uintString,
  sponsor: address,
  sponsorName: z.string(),
  name: z.string(),
  description: z.string(),
  token: address,
  tokenSymbol,
  pricing: z.union([z.literal(0), z.literal(1)]),
  amountPerPresence: uintString,
  attendeeShareBps: z.number().int().min(0).max(10_000),
  feeBps: z.number().int().min(0).max(10_000),
  minProofMode: mode,
  requireQieId: z.boolean(),
  startsAt: iso,
  endsAt: iso,
  balance: uintString,
  funded: uintString,
  settledCount: z.number().int(),
  settledAmount: uintString,
  teamFunded: z.boolean(),
  status: z.enum(["scheduled", "live", "ended", "refundable", "refunded"]),
}) satisfies z.ZodType<CampaignSummary>;

/** Settlement plus the optional .qie names the API may add (requested from workstream B). */
export const settlementSchema = z.object({
  campaignId: uintString,
  eventId: uintString,
  eventName: z.string(),
  attendee: address,
  attendeeName: z.string().nullable().optional(),
  organizer: address,
  organizerName: z.string().nullable().optional(),
  gross: uintString,
  toAttendee: uintString,
  toOrganizer: uintString,
  fee: uintString,
  at: iso,
  tx: hex,
});
export type SponsorSettlement = Settlement & { attendeeName?: string | null; organizerName?: string | null };

export const campaignDetailSchema = campaignSummarySchema.extend({
  events: z.array(eventSummarySchema.extend({ approved: z.boolean(), settled: z.number().int() })),
  settlements: z.array(settlementSchema),
});
export type SponsorCampaignDetail = Omit<CampaignDetail, "settlements"> & { settlements: SponsorSettlement[] };

/** `/api/campaigns/[id]/report?format=json`: the campaign with every settlement, not just the latest 200. */
export const reportSchema = z.object({ generatedAt: iso, campaign: campaignDetailSchema });

export const sessionSchema = z.object({
  address,
  qieName: z.string().nullable(),
  expiresAt: iso,
}) satisfies z.ZodType<Session>;

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), action: z.string() }),
});

/** List routes return a bare array; accept `{ <key>: [...] }` as well so either shape from B works. */
export function listOf<T extends z.ZodType>(item: T, key: string) {
  return z.union([z.array(item), z.object({ [key]: z.array(item) }).transform((o) => o[key] as z.output<T>[])]);
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly copy: PlainError;
  constructor(status: number, copy: PlainError) {
    super(copy.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.copy = copy;
  }
}

const NETWORK: PlainError = {
  message: "Showmark could not be reached.",
  action: "Check your connection and try again.",
};

const SHAPE: PlainError = {
  message: "Showmark sent data this page does not understand.",
  action: "Reload the page. If it keeps happening, tell the Showmark team.",
};

function serverError(status: number): PlainError {
  if (status === 404) return { message: "Showmark has no record of this.", action: "Check the link and try again." };
  if (status === 429) return { message: "Too many requests in the last minute.", action: "Wait a minute and try again." };
  return { message: "Showmark could not read this just now.", action: "Try again in a moment." };
}

/** Fetches JSON and validates it. Throws ApiRequestError with plain copy on any failure. */
export async function apiGet<T extends z.ZodType>(url: string, schema: T, init?: RequestInit): Promise<z.output<T>> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" }, ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError(0, NETWORK);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error : serverError(response.status));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiRequestError(response.status, SHAPE);
  return parsed.data;
}

export async function apiPost<T extends z.ZodType>(url: string, payload: unknown, schema: T): Promise<z.output<T>> {
  return apiGet(url, schema, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
}

export const sponsorApi = {
  campaigns: (sponsor: Address) => `/api/campaigns?sponsor=${sponsor}&limit=100`,
  campaign: (id: string) => `/api/campaigns/${encodeURIComponent(id)}`,
  report: (id: string, format: "csv" | "json") => `/api/campaigns/${encodeURIComponent(id)}/report?format=${format}`,
  events: () => `/api/events?limit=100`,
} as const;
