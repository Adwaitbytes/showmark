import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { byteLength, DEFAULT_PASS_AGE, encodeMetadata, parseLocalDateTime, toLocalDateTimeValue, validateEventForm, type EventFormValues } from "./event-form";
import { attendeesCsv } from "./csv";
import { formatQie } from "./tx";

const NOW = new Date(2026, 10, 20, 10, 0);

function form(patch: Partial<EventFormValues> = {}): EventFormValues {
  return {
    name: "Builders night",
    venue: "Hall B, second floor",
    city: "Bengaluru",
    description: "Lightning talks and pizza.",
    url: "",
    startsAt: "2026-11-27T18:30",
    endsAt: "2026-11-27T21:00",
    capacity: "180",
    maxPassAge: String(DEFAULT_PASS_AGE),
    series: "none",
    seriesName: "",
    ...patch,
  };
}

describe("event form", () => {
  it("accepts a normal event and produces the on-chain values", () => {
    const result = validateEventForm(form(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capacity).toBe(180);
    expect(result.value.maxPassAge).toBe(120);
    expect(result.value.startsAt).toBe(BigInt(new Date(2026, 10, 27, 18, 30).getTime() / 1000));
    expect(JSON.parse(result.value.metadataJson)).toEqual({
      v: 1,
      name: "Builders night",
      venue: "Hall B, second floor",
      city: "Bengaluru",
      description: "Lightning talks and pizza.",
    });
    expect(result.value.series).toEqual({ kind: "none" });
  });

  it("treats an empty capacity as no limit", () => {
    const result = validateEventForm(form({ capacity: "" }), NOW);
    expect(result.ok && result.value.capacity).toBe(0);
  });

  it("says what to fix for each bad field", () => {
    const result = validateEventForm(
      form({ name: "", endsAt: "2026-11-27T17:00", capacity: "-3", maxPassAge: "5", url: "showmark.app", series: "new", seriesName: "" }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toMatch(/at least 3/);
    expect(result.errors.endsAt).toMatch(/after the start/);
    expect(result.errors.capacity).toMatch(/whole number/);
    expect(result.errors.maxPassAge).toMatch(/between 30 and 600/);
    expect(result.errors.url).toMatch(/https/);
    expect(result.errors.seriesName).toMatch(/Name the series/);
  });

  it("rejects an event that already ended", () => {
    const result = validateEventForm(form({ startsAt: "2026-11-01T10:00", endsAt: "2026-11-01T12:00" }), NOW);
    expect(!result.ok && result.errors.endsAt).toMatch(/already passed/);
  });

  it("enforces the 2,048 byte limit on the encoded metadata, counting multi-byte characters", () => {
    const description = "ह".repeat(700); // Devanagari: 3 bytes each in UTF-8, 2,100 bytes
    const result = validateEventForm(form({ description }), NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.description).toMatch(/bytes/);
    expect(byteLength("ह")).toBe(3);
  });

  it("picks an existing series by id", () => {
    const result = validateEventForm(form({ series: "existing:4" }), NOW);
    expect(result.ok && result.value.series).toEqual({ kind: "existing", seriesId: 4n });
  });

  it("keeps the url only when given", () => {
    expect(encodeMetadata({ v: 1, name: "a", venue: "b", city: "c", description: "", url: "https://x.org" })).toContain('"url"');
    expect(encodeMetadata({ v: 1, name: "a", venue: "b", city: "c", description: "" })).not.toContain("url");
  });

  it("round-trips local date time values and rejects impossible dates", () => {
    const date = new Date(2026, 10, 27, 18, 30);
    expect(parseLocalDateTime(toLocalDateTimeValue(date))?.getTime()).toBe(date.getTime());
    expect(parseLocalDateTime("2026-11-31T10:00")).toBeNull();
    expect(parseLocalDateTime("tomorrow")).toBeNull();
  });
});

describe("gas amounts", () => {
  it("shows small QIE amounts with a few significant digits", () => {
    expect(formatQie(21_000n * 7n)).toBe("<0.000001");
    expect(formatQie(200_000n * 1_125_000_000n)).toBe("0.000225");
    expect(formatQie(123_456_789_000_000n)).toBe("0.000123");
    expect(formatQie(1_250_000_000_000_000_000n)).toBe("1.25");
    expect(formatQie(0n)).toBe("0");
  });
});

describe("attendee csv", () => {
  it("quotes commas and neutralises spreadsheet formulas", () => {
    const csv = attendeesCsv(
      [{ attendee: "0xabc", qieName: "=cmd,x", mode: 2, doorTime: "2026-11-27T13:00:00.000Z", streak: 3, tx: "0x01" }],
      (h) => `https://mainnet.qie.digital/tx/${h}`,
    );
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("attendee,qie_name,proof_mode,door_time_utc,streak,transaction,explorer_link");
    expect(row).toBe(`0xabc,"'=cmd,x",door scans you,2026-11-27T13:00:00.000Z,3,0x01,https://mainnet.qie.digital/tx/0x01`);
  });
});
