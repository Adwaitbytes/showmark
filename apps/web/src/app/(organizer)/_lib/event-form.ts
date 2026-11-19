import { z } from "zod";
import type { EventMetadata } from "@/lib/api/types";

// The event form: what organizers type, checked before anything is sent to the chain. The chain only checks that
// the metadata is at most 2,048 bytes and that the event ends after it starts, so this is where every other mistake
// is caught, with a message that says how to fix it.

export const MAX_METADATA_BYTES = 2048;
export const MIN_PASS_AGE = 30;
export const MAX_PASS_AGE = 600;
/** Two minutes: long enough for a slow phone on mobile data, short enough that a forwarded photo stops working. */
export const DEFAULT_PASS_AGE = 120;
export const MAX_CAPACITY = 4_294_967_295;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `Add the ${label}.` : `The ${label} needs at least ${min} characters.`)
    .max(max, `Keep the ${label} under ${max} characters.`);

export const eventMetadataSchema = z.object({
  v: z.literal(1),
  name: text("event name", 3, 120),
  venue: text("venue", 1, 160),
  city: text("city", 1, 80),
  description: z.string().trim().max(1200, "Keep the description under 1,200 characters."),
  url: z
    .string()
    .trim()
    .max(300, "Keep the link under 300 characters.")
    .refine((v) => /^https:\/\/[^\s]+\.[^\s]+$/.test(v), "Use a full link that starts with https://.")
    .optional(),
}) satisfies z.ZodType<EventMetadata>;

/** The exact JSON string written on-chain. Keys in a fixed order so the same details always cost the same. */
export function encodeMetadata(metadata: EventMetadata): string {
  const { v, name, venue, city, description, url } = metadata;
  return JSON.stringify(url ? { v, name, venue, city, description, url } : { v, name, venue, city, description });
}

export function encodeSeriesMetadata(name: string): string {
  return JSON.stringify({ v: 1, name: name.trim() });
}

/** Parses a datetime-local value ("2026-11-27T18:30") as device local time. */
export function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject values the Date constructor rolled over, such as 31 November.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Formats a Date for a datetime-local input, in device local time. */
export function toLocalDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type SeriesChoice = { kind: "none" } | { kind: "new"; name: string } | { kind: "existing"; seriesId: bigint };

export interface EventFormValues {
  name: string;
  venue: string;
  city: string;
  description: string;
  url: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  maxPassAge: string;
  series: "none" | "new" | `existing:${string}`;
  seriesName: string;
}

export interface ValidEvent {
  metadata: EventMetadata;
  metadataJson: string;
  startsAt: bigint;
  endsAt: bigint;
  capacity: number;
  maxPassAge: number;
  series: SeriesChoice;
}

export type FieldErrors = Partial<Record<keyof EventFormValues, string>>;

export type ValidationResult = { ok: true; value: ValidEvent } | { ok: false; errors: FieldErrors };

const MAX_EVENT_HOURS = 24 * 14;

export function validateEventForm(values: EventFormValues, now: Date = new Date()): ValidationResult {
  const errors: FieldErrors = {};

  const metadataInput = {
    v: 1 as const,
    name: values.name,
    venue: values.venue,
    city: values.city,
    description: values.description,
    ...(values.url.trim() ? { url: values.url } : {}),
  };
  const parsed = eventMetadataSchema.safeParse(metadataInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && key in values && !errors[key as keyof EventFormValues]) {
        errors[key as keyof EventFormValues] = issue.message;
      }
    }
  }

  const startsAt = parseLocalDateTime(values.startsAt);
  const endsAt = parseLocalDateTime(values.endsAt);
  if (!startsAt) errors.startsAt = "Pick the date and time the event starts.";
  if (!endsAt) errors.endsAt = "Pick the date and time the event ends.";
  if (startsAt && endsAt) {
    if (endsAt.getTime() <= startsAt.getTime()) errors.endsAt = "The end time must be after the start time.";
    else if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_HOURS * 3_600_000) errors.endsAt = "An event can last at most 14 days. Split longer ones into a series.";
    // Check-in stays open until an hour after the end, so an event that ended more than an hour ago can never be used.
    if (endsAt.getTime() + 3_600_000 < now.getTime()) errors.endsAt = "This end time has already passed. Pick a time in the future.";
  }

  const capacityText = values.capacity.trim();
  const capacity = capacityText === "" ? 0 : Number(capacityText);
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > MAX_CAPACITY) {
    errors.capacity = "Use a whole number of people, or leave it empty for no limit.";
  }

  const maxPassAge = Number(values.maxPassAge);
  if (!Number.isInteger(maxPassAge) || maxPassAge < MIN_PASS_AGE || maxPassAge > MAX_PASS_AGE) {
    errors.maxPassAge = `Pick a value between ${MIN_PASS_AGE} and ${MAX_PASS_AGE} seconds.`;
  }

  let series: SeriesChoice = { kind: "none" };
  if (values.series === "new") {
    const name = values.seriesName.trim();
    if (name.length < 3) errors.seriesName = "Name the series, for example the name of your weekly meetup.";
    else if (name.length > 120) errors.seriesName = "Keep the series name under 120 characters.";
    else series = { kind: "new", name };
  } else if (values.series.startsWith("existing:")) {
    const id = values.series.slice("existing:".length);
    if (/^[1-9]\d*$/.test(id)) series = { kind: "existing", seriesId: BigInt(id) };
    else errors.series = "Pick a series from the list.";
  }

  let metadataJson = "";
  if (parsed.success) {
    metadataJson = encodeMetadata(parsed.data);
    const size = byteLength(metadataJson);
    if (size > MAX_METADATA_BYTES) {
      errors.description = `The details come to ${size.toLocaleString("en-US")} bytes and the chain accepts ${MAX_METADATA_BYTES.toLocaleString("en-US")}. Shorten the description.`;
    }
  }

  if (Object.keys(errors).length > 0 || !parsed.success || !startsAt || !endsAt) return { ok: false, errors };
  return {
    ok: true,
    value: {
      metadata: parsed.data,
      metadataJson,
      startsAt: BigInt(Math.floor(startsAt.getTime() / 1000)),
      endsAt: BigInt(Math.floor(endsAt.getTime() / 1000)),
      capacity,
      maxPassAge,
      series,
    },
  };
}
