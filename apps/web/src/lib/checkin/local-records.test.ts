import { describe, expect, it } from "vitest";
import type { Stamp } from "@/lib/api/types";
import type { PassStorage } from "@/lib/wallet/pass";
import { dictionaries, hiApiErrors, localizedError } from "./i18n";
import { mergeStamps, outboxEntries, recentEvents, rememberEvent, removeFromOutbox, saveToOutbox } from "./local-records";
import type { CheckInRequest } from "./sign";

class MemoryStorage implements PassStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const request = (eventId: string, doorTime = "1"): CheckInRequest => ({
  eventId,
  attendee: "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
  mode: 1,
  doorTime,
  attendeeSig: `0x${"11".repeat(65)}`,
  doorSig: `0x${"22".repeat(65)}`,
});

const stamp = (eventId: string, at: string): Stamp => ({ eventId, eventName: `Event ${eventId}`, city: "Pune", at, mode: 1, tx: `0x${"ab".repeat(32)}`, streak: 0 });

describe("outbox", () => {
  it("keeps one signed check-in per event, replacing an older scan", () => {
    const storage = new MemoryStorage();
    saveToOutbox({ request: request("1", "100"), eventName: null, savedAt: 1 }, storage);
    saveToOutbox({ request: request("1", "200"), eventName: "Meetup", savedAt: 2 }, storage);
    saveToOutbox({ request: request("2"), eventName: null, savedAt: 3 }, storage);
    expect(outboxEntries(storage).map((e) => [e.request.eventId, e.request.doorTime])).toEqual([
      ["2", "1"],
      ["1", "200"],
    ]);
    removeFromOutbox(request("1"), storage);
    expect(outboxEntries(storage)).toHaveLength(1);
  });

  it("ignores tampered or corrupted entries", () => {
    const storage = new MemoryStorage();
    storage.setItem("showmark.outbox.v1", JSON.stringify([{ request: { eventId: "x" }, savedAt: 1, eventName: null }, "junk"]));
    expect(outboxEntries(storage)).toEqual([]);
    storage.setItem("showmark.outbox.v1", "{not json");
    expect(outboxEntries(storage)).toEqual([]);
  });
});

describe("recent events", () => {
  it("puts the newest first and keeps a known name when a later visit has none", () => {
    const storage = new MemoryStorage();
    rememberEvent({ eventId: "1", name: "Builders meetup", openedAt: 1 }, storage);
    rememberEvent({ eventId: "2", name: null, openedAt: 2 }, storage);
    rememberEvent({ eventId: "1", name: null, openedAt: 3 }, storage);
    expect(recentEvents(storage)).toEqual([
      { eventId: "1", name: "Builders meetup", openedAt: 3 },
      { eventId: "2", name: null, openedAt: 2 },
    ]);
  });
});

describe("mergeStamps", () => {
  it("prefers indexed stamps and fills in the ones the index has not seen", () => {
    const merged = mergeStamps([stamp("1", "2026-11-20T10:00:00Z")], [stamp("1", "2026-11-20T10:00:01Z"), stamp("2", "2026-11-21T10:00:00Z")]);
    expect(merged.map((m) => [m.stamp.eventId, m.indexed])).toEqual([
      ["2", false],
      ["1", true],
    ]);
  });
});

describe("i18n", () => {
  it("has a Hindi string for every English one", () => {
    const shape = (value: unknown): unknown =>
      typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)])) : typeof value;
    expect(shape(dictionaries.hi)).toEqual(shape(dictionaries.en));
  });

  it("follows the copy rules in both languages", () => {
    const strings: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push(String(value(2, 3)), String(value("x")));
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
    };
    collect(dictionaries);
    collect(hiApiErrors);
    const banned = /seamless|revolutioni[sz]e|unlock|empower|leverage|cutting-edge|next-generation|game-changing|effortless|supercharge|reimagine/i;
    for (const s of strings) {
      expect(s, s).not.toMatch(/[–—!]/);
      expect(s, s).not.toMatch(banned);
    }
  });

  it("uses the API's own words in English and Hindi copy when it knows the code", () => {
    const english = { message: "This event is full.", action: "Ask the organizer." };
    expect(localizedError("en", "at_capacity", english)).toBe(english);
    expect(localizedError("hi", "at_capacity", english)).toBe(hiApiErrors.at_capacity);
    expect(localizedError("hi", "some_new_code", english)).toBe(english);
  });
});
