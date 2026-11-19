import type { Hex } from "viem";
import type { Stamp } from "@/lib/api/types";
import type { CheckInRequest } from "./sign";
import { browserStorage, readJson, writeJson, type KeyValueStorage } from "./storage";

// What this phone remembers besides the pass key. None of it is a source of truth: presence and money
// are read from the chain. These records only bridge the seconds before the index catches up, keep a
// signed check-in alive through a network outage, and remember which events the person opened.

export const OUTBOX_KEY = "showmark.outbox.v1";
export const STAMPS_KEY = "showmark.stamps.v1";
export const RECENT_KEY = "showmark.recent-events.v1";
const LINK_PROMPT_KEY = "showmark.link-prompt-dismissed.v1";

const MAX_RECENT = 8;
const MAX_LOCAL_STAMPS = 50;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

// ----------------------------------------------------------------------------------------- outbox

export interface OutboxEntry {
  request: CheckInRequest;
  eventName: string | null;
  savedAt: number;
}

function isCheckInRequest(value: unknown): value is CheckInRequest {
  if (!isObject(value)) return false;
  return (
    typeof value.eventId === "string" &&
    /^\d+$/.test(value.eventId) &&
    isHex(value.attendee) &&
    value.mode === 1 &&
    typeof value.doorTime === "string" &&
    /^\d+$/.test(value.doorTime) &&
    isHex(value.ticket) &&
    value.ticket.length === 42 &&
    isHex(value.attendeeSig) &&
    isHex(value.doorSig) &&
    isHex(value.ticketSig)
  );
}

function readOutbox(storage: KeyValueStorage | null): OutboxEntry[] {
  const value = readJson(storage, OUTBOX_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is OutboxEntry =>
      isObject(e) && isCheckInRequest(e.request) && typeof e.savedAt === "number" && (e.eventName === null || typeof e.eventName === "string"),
  );
}

/** Signed check-ins that have not reached the network, newest first. */
export function outboxEntries(storage: KeyValueStorage | null = browserStorage()): OutboxEntry[] {
  return readOutbox(storage).sort((a, b) => b.savedAt - a.savedAt);
}

/** Keeps one signed check-in per event and pass; a newer scan replaces an older one. */
export function saveToOutbox(entry: OutboxEntry, storage: KeyValueStorage | null = browserStorage()): void {
  const rest = readOutbox(storage).filter((e) => !sameCheckIn(e.request, entry.request));
  writeJson(storage, OUTBOX_KEY, [entry, ...rest]);
}

export function removeFromOutbox(request: CheckInRequest, storage: KeyValueStorage | null = browserStorage()): void {
  const all = readOutbox(storage);
  const rest = all.filter((e) => !sameCheckIn(e.request, request));
  if (rest.length !== all.length) writeJson(storage, OUTBOX_KEY, rest);
}

function sameCheckIn(a: CheckInRequest, b: CheckInRequest): boolean {
  return a.eventId === b.eventId && a.attendee.toLowerCase() === b.attendee.toLowerCase();
}

// ----------------------------------------------------------------------------------- local stamps

export interface LocalStamp extends Stamp {
  holder: string;
}

function isLocalStamp(value: unknown): value is LocalStamp {
  if (!isObject(value)) return false;
  return (
    typeof value.eventId === "string" &&
    typeof value.eventName === "string" &&
    typeof value.city === "string" &&
    typeof value.at === "string" &&
    (value.mode === 1 || value.mode === 2) &&
    isHex(value.tx) &&
    typeof value.streak === "number" &&
    typeof value.holder === "string"
  );
}

/** Stamps confirmed on this phone (the tx was mined), for the minute before the indexer has them. */
export function localStamps(holder: string, storage: KeyValueStorage | null = browserStorage()): LocalStamp[] {
  const value = readJson(storage, STAMPS_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isLocalStamp).filter((s) => s.holder.toLowerCase() === holder.toLowerCase());
}

export function recordLocalStamp(stamp: LocalStamp, storage: KeyValueStorage | null = browserStorage()): void {
  const value = readJson(storage, STAMPS_KEY);
  const all = Array.isArray(value) ? value.filter(isLocalStamp) : [];
  const rest = all.filter((s) => !(s.eventId === stamp.eventId && s.holder.toLowerCase() === stamp.holder.toLowerCase()));
  writeJson(storage, STAMPS_KEY, [stamp, ...rest].slice(0, MAX_LOCAL_STAMPS));
}

/** Indexed stamps win; local ones fill in what the index has not seen yet. Newest first. */
export function mergeStamps(indexed: readonly Stamp[], local: readonly Stamp[]): { stamp: Stamp; indexed: boolean }[] {
  const known = new Set(indexed.map((s) => s.eventId));
  const merged = [
    ...indexed.map((stamp) => ({ stamp, indexed: true })),
    ...local.filter((s) => !known.has(s.eventId)).map((stamp) => ({ stamp, indexed: false })),
  ];
  return merged.sort((a, b) => Date.parse(b.stamp.at) - Date.parse(a.stamp.at));
}

// --------------------------------------------------------------------------------- recent events

export interface RecentEvent {
  eventId: string;
  name: string | null;
  openedAt: number;
}

/** Events whose door code this phone opened, newest first. The attendee code defaults to the newest. */
export function recentEvents(storage: KeyValueStorage | null = browserStorage()): RecentEvent[] {
  const value = readJson(storage, RECENT_KEY);
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is RecentEvent =>
        isObject(e) && typeof e.eventId === "string" && /^\d+$/.test(e.eventId) && typeof e.openedAt === "number" && (e.name === null || typeof e.name === "string"),
    )
    .sort((a, b) => b.openedAt - a.openedAt);
}

export function rememberEvent(event: RecentEvent, storage: KeyValueStorage | null = browserStorage()): void {
  const existing = recentEvents(storage).find((e) => e.eventId === event.eventId);
  const name = event.name ?? existing?.name ?? null;
  const rest = recentEvents(storage).filter((e) => e.eventId !== event.eventId);
  writeJson(storage, RECENT_KEY, [{ ...event, name }, ...rest].slice(0, MAX_RECENT));
}

// ------------------------------------------------------------------------------- link prompt

export function linkPromptDismissed(storage: KeyValueStorage | null = browserStorage()): boolean {
  return storage?.getItem(LINK_PROMPT_KEY) === "1";
}

export function dismissLinkPrompt(storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.setItem(LINK_PROMPT_KEY, "1");
  } catch {
    // Showing the prompt again next time is harmless.
  }
}
