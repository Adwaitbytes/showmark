import { describe, expect, it } from "vitest";
import { markSpec, markSvg, stampDataUri, stampSpec, stampSvg, type StampParams } from "./stampSvg";

const base: StampParams = {
  eventId: "12",
  eventName: "Campus builders meetup",
  city: "Bengaluru",
  at: "2026-11-27T13:12:00.000Z",
  mode: 1,
  holder: "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
};

describe("stampSvg", () => {
  it("is deterministic for the same event and holder", () => {
    expect(stampSvg(base)).toBe(stampSvg({ ...base }));
  });

  it("gives every holder the same design but a different tilt", () => {
    const a = stampSpec(base);
    const b = stampSpec({ ...base, holder: "0x2F9d41aE7b3C5e8D1a6F0b4C9e2D7a5B3c1E8f06" });
    expect(a.shape).toBe(b.shape);
    expect(a.ink).toBe(b.ink);
    expect(a.rotation).not.toBe(b.rotation);
    expect(Math.abs(a.rotation)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(a.rotation)).toBeLessThanOrEqual(9.5);
  });

  it("escapes on-chain text so metadata cannot inject markup", () => {
    const svg = stampSvg({
      ...base,
      eventName: `</text><script>alert("x")</script>`,
      city: `"><image href="https://evil.example/x.png"/>`,
      shape: "box",
    });
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<image");
    expect(svg).toContain("&lt;/TEXT&gt;&lt;SCRIPT&gt;");
  });

  it("strips control characters from metadata", () => {
    const svg = stampSvg({ ...base, eventName: "Bad\u0000name\u0007here" });
    expect(svg).not.toMatch(/[\u0000-\u0008]/);
  });

  it("prints the event number unless the serial is turned off", () => {
    expect(stampSvg({ ...base, shape: "round" })).toContain("NO. 12");
    expect(stampSvg({ ...base, shape: "round", serial: null })).not.toContain("NO.");
  });

  it("draws a double inner rim only for door scans you", () => {
    const circles = (svg: string) => (svg.match(/<circle /g) ?? []).length;
    expect(circles(stampSvg({ ...base, shape: "round", mode: 2 }))).toBe(circles(stampSvg({ ...base, shape: "round" })) + 1);
  });

  it("uses theme variables inline and fixed inks for print", () => {
    expect(stampSvg({ ...base, ink: "stamp-blue" })).toContain("var(--stamp-blue)");
    const print = stampSvg({ ...base, ink: "stamp-blue", color: "print" });
    expect(print).toContain('color="#2B4BD9"');
    expect(print).not.toContain("var(--");
  });

  it("fits long names by shrinking, then truncating", () => {
    const svg = stampSvg({ ...base, shape: "round", eventName: "A".repeat(120) });
    expect(svg).toContain("…");
  });
});

describe("stampDataUri", () => {
  it("returns a base64 SVG data URI that decodes to the print artwork", () => {
    const uri = stampDataUri(base);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const decoded = Buffer.from(uri.split(",")[1] ?? "", "base64").toString("utf8");
    expect(decoded).toBe(stampSvg({ ...base, color: "print" }));
  });
});

describe("markSvg", () => {
  it("prints escaped capitals in a double frame with a stable tilt", () => {
    const svg = markSvg({ lines: ["Awaiting", "first <check-in>"], seed: "traction" });
    expect(svg).toContain("AWAITING");
    expect(svg).toContain("FIRST &lt;CHECK-IN&gt;");
    expect((svg.match(/<rect /g) ?? []).length).toBe(2);
    expect(markSpec({ seed: "traction", lines: ["A"] }).rotation).toBe(markSpec({ seed: "traction", lines: ["B"] }).rotation);
  });
});
