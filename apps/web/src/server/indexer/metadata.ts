import { z } from "zod";

// Metadata strings are written on-chain by anyone who creates an event or a campaign, so they are untrusted.
// Parsing never throws: a malformed string still indexes, with a plain fallback name, so one bad event cannot
// stall the indexer. Links are kept only when they are http(s), so a `javascript:` URL can never reach a page.

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .catch("");

const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  })
  .optional()
  .catch(undefined);

const eventSchema = z.object({ name: text(120), venue: text(160), city: text(80), description: text(2000), url: safeUrl });
const campaignSchema = z.object({ name: text(120), sponsor: text(120), description: text(2000), url: safeUrl });
const seriesSchema = z.object({ name: text(120) });

export interface ParsedEventMetadata {
  name: string;
  venue: string;
  city: string;
  description: string;
  url: string | null;
}

export interface ParsedCampaignMetadata {
  name: string;
  sponsorName: string;
  description: string;
  url: string | null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseEventMetadata(raw: string, eventId: bigint): ParsedEventMetadata {
  const parsed = eventSchema.safeParse(parseJson(raw));
  const fallbackName = `Event ${eventId}`;
  if (!parsed.success) return { name: fallbackName, venue: "", city: "", description: "", url: null };
  const m = parsed.data;
  return { name: m.name || fallbackName, venue: m.venue, city: m.city, description: m.description, url: m.url ?? null };
}

export function parseCampaignMetadata(raw: string, campaignId: bigint): ParsedCampaignMetadata {
  const parsed = campaignSchema.safeParse(parseJson(raw));
  const fallbackName = `Campaign ${campaignId}`;
  if (!parsed.success) return { name: fallbackName, sponsorName: "", description: "", url: null };
  const m = parsed.data;
  return { name: m.name || fallbackName, sponsorName: m.sponsor, description: m.description, url: m.url ?? null };
}

/** Series metadata is `{"name": string}` JSON; a bare string is accepted as the name. */
export function parseSeriesName(raw: string, seriesId: bigint): string {
  const parsed = seriesSchema.safeParse(parseJson(raw));
  if (parsed.success && parsed.data.name) return parsed.data.name;
  const plain = raw.trim().slice(0, 120);
  return plain && !plain.startsWith("{") ? plain : `Series ${seriesId}`;
}
