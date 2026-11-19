import { describe, expect, it } from "vitest";
import { findSoftSignals, largestBurst, type SettlementLike } from "./anomalies";

const ORG_A = "0x1111111111111111111111111111111111111111";
const ORG_B = "0x2222222222222222222222222222222222222222";

function s(eventId: string, attendee: number, at: number, organizer = ORG_A): SettlementLike {
  return {
    eventId,
    eventName: `Event ${eventId}`,
    attendee: `0x${attendee.toString(16).padStart(40, "0")}`,
    organizer,
    at: new Date(Date.UTC(2026, 10, 25, 12, 0, 0) + at * 1000).toISOString(),
  };
}

describe("largestBurst", () => {
  it("counts the busiest sliding window", () => {
    expect(largestBurst([0, 10, 20, 100, 105], 30)).toBe(3);
    expect(largestBurst([], 30)).toBe(0);
  });
});

describe("findSoftSignals", () => {
  it("is quiet for an ordinary event", () => {
    const rows = Array.from({ length: 40 }, (_, i) => s("1", i, i * 20));
    expect(findSoftSignals(rows)).toEqual([]);
  });

  it("flags many check-ins within a minute at one event", () => {
    const rows = Array.from({ length: 32 }, (_, i) => s("1", i, i));
    const signals = findSoftSignals(rows);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "burst", title: "32 check-ins within 60 seconds at Event 1" });
  });

  it("flags one organizer taking most payouts across several events", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => s("1", i, i * 300, ORG_A)),
      ...Array.from({ length: 2 }, (_, i) => s("2", 100 + i, i * 300, ORG_B)),
    ];
    expect(findSoftSignals(rows).map((x) => x.kind)).toEqual(["concentration"]);
  });

  it("does not flag concentration when the campaign has a single event", () => {
    const rows = Array.from({ length: 12 }, (_, i) => s("1", i, i * 300));
    expect(findSoftSignals(rows)).toEqual([]);
  });

  it("flags an attendee paid at two different events within 30 minutes", () => {
    const rows = [s("1", 7, 0, ORG_A), s("2", 7, 600, ORG_B)];
    const signals = findSoftSignals(rows);
    expect(signals).toEqual([expect.objectContaining({ kind: "hopping", title: "1 attendee was paid at two events within 30 minutes" })]);
  });
});
