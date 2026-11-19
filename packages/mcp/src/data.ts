import { z } from "zod";
import { apiError, campaignDetail, eventDetail, eventSummary, passport, traction } from "./schemas";
import type { CampaignDetail, EventDetail, EventSummary, Passport, Traction } from "./schemas";

/**
 * Where the MCP server gets indexed Showmark data. The standalone server reads the public HTTP API; the Next.js
 * route passes the app's server query functions directly, so no request leaves the process.
 */
export interface ShowmarkDataSource {
  getTraction(): Promise<Traction>;
  listEvents(filter: { organizer?: `0x${string}`; upcoming?: boolean; limit?: number }): Promise<EventSummary[]>;
  /** Null when no event has this id. */
  getEvent(id: string): Promise<EventDetail | null>;
  /** Null when no campaign has this id. */
  getCampaign(id: string): Promise<CampaignDetail | null>;
  /** Null when the address or .qie name has no Showmark passport. */
  getPassport(addressOrName: string): Promise<Passport | null>;
}

/** A data source failure with copy an agent can repeat: what happened and what to do next. */
export class ShowmarkDataError extends Error {
  readonly code: string;
  readonly action: string;

  constructor(params: { code: string; message: string; action: string }, options?: { cause?: unknown }) {
    super(params.message, options);
    this.name = "ShowmarkDataError";
    this.code = params.code;
    this.action = params.action;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDataSourceOptions {
  /** Base URL of a Showmark deployment, for example https://showmark.app. */
  apiUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Reads the Showmark public API (docs/INTERFACES.md section 3) and validates every response. */
export function httpDataSource(options: HttpDataSourceOptions): ShowmarkDataSource {
  let base: string;
  try {
    const url = new URL(options.apiUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch (cause) {
    throw new ShowmarkDataError(
      { code: "bad_api_url", message: `SHOWMARK_API_URL is not an http or https URL: ${options.apiUrl}`, action: "Set it to the site, for example https://showmark.app." },
      { cause },
    );
  }
  const doFetch: FetchLike = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function get<T>(path: string, schema: z.ZodType<T>, allowNotFound: true): Promise<T | null>;
  async function get<T>(path: string, schema: z.ZodType<T>, allowNotFound: false): Promise<T>;
  async function get<T>(path: string, schema: z.ZodType<T>, allowNotFound: boolean): Promise<T | null> {
    const url = `${base}${path}`;
    let response: Response;
    try {
      response = await doFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      throw new ShowmarkDataError(
        { code: "unreachable", message: `The Showmark API at ${base} did not answer.`, action: "Check SHOWMARK_API_URL and try again in a few seconds." },
        { cause },
      );
    }
    if (response.status === 404 && allowNotFound) return null;
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ShowmarkDataError(
        { code: "bad_response", message: `The Showmark API answered ${path} with HTTP ${response.status} and no JSON body.`, action: "Try again later." },
        { cause },
      );
    }
    if (!response.ok) {
      const parsed = apiError.safeParse(body);
      throw new ShowmarkDataError(
        parsed.success
          ? parsed.data.error
          : { code: `http_${response.status}`, message: `The Showmark API answered ${path} with HTTP ${response.status}.`, action: "Try again later." },
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ShowmarkDataError(
        { code: "unexpected_shape", message: `The Showmark API answered ${path} with an unexpected shape.`, action: "Check that the MCP server and the site run matching versions." },
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  // The list route may answer with a bare array or wrap it as { events }; accept both.
  const eventList = z.union([z.array(eventSummary), z.object({ events: z.array(eventSummary) }).transform((v) => v.events)]);

  return {
    getTraction: () => get("/api/traction", traction, false),
    async listEvents(filter) {
      const query = new URLSearchParams();
      if (filter.organizer) query.set("organizer", filter.organizer);
      if (filter.upcoming) query.set("upcoming", "1");
      if (filter.limit !== undefined) query.set("limit", String(filter.limit));
      const qs = query.toString();
      return get(`/api/events${qs ? `?${qs}` : ""}`, eventList, false);
    },
    getEvent: (id) => get(`/api/events/${encodeURIComponent(id)}`, eventDetail, true),
    getCampaign: (id) => get(`/api/campaigns/${encodeURIComponent(id)}`, campaignDetail, true),
    getPassport: (addressOrName) => get(`/api/passport/${encodeURIComponent(addressOrName)}`, passport, true),
  };
}
