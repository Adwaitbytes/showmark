import { describe, expect, it } from "vitest";
import { basisPointsToPercent, formatEventWindow, formatTokenAmount, shortAddress, shortHash } from "./format";

describe("formatTokenAmount", () => {
  it("formats QUSDC base units with cents", () => {
    expect(formatTokenAmount("1200000", "QUSDC")).toBe("1.20");
    expect(formatTokenAmount("4800000", "QUSDC")).toBe("4.80");
    expect(formatTokenAmount("0", "QUSDC")).toBe("0.00");
  });

  it("groups thousands and drops trailing zeros for QIE", () => {
    expect(formatTokenAmount("1250000000000000000000", "QIE")).toBe("1,250");
    expect(formatTokenAmount("1500000000000000000", "QIE")).toBe("1.5");
    expect(formatTokenAmount("0", "QIE")).toBe("0");
  });

  it("truncates instead of rounding up", () => {
    expect(formatTokenAmount("1999999", "QUSDC")).toBe("1.99");
    expect(formatTokenAmount("123456789000000000", "QIE")).toBe("0.1234");
  });

  it("shows dust as less than the smallest visible unit", () => {
    expect(formatTokenAmount("1", "QUSDC")).toBe("<0.01");
    expect(formatTokenAmount("10", "QIE")).toBe("<0.0001");
  });

  it("handles amounts beyond Number precision", () => {
    expect(formatTokenAmount("123456789012345678901234567890", "QIE")).toBe("123,456,789,012.3456");
  });

  it("rejects anything that is not a decimal string", () => {
    expect(() => formatTokenAmount("-1", "QIE")).toThrow();
    expect(() => formatTokenAmount("1e18", "QIE")).toThrow();
    expect(() => formatTokenAmount("0x10", "QIE")).toThrow();
  });
});

describe("short forms", () => {
  it("shortens addresses and hashes and leaves short strings alone", () => {
    expect(shortAddress("0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b")).toBe("0x7aE3…1A3b");
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xababab…ababab");
    expect(shortAddress("0x1234")).toBe("0x1234");
  });
});

describe("dates", () => {
  it("formats an event window in IST on one day", () => {
    expect(formatEventWindow("2026-11-27T12:30:00.000Z", "2026-11-27T15:30:00.000Z")).toBe(
      "27 Nov 2026, 18:00 to 21:00 IST",
    );
  });

  it("names both days when the event crosses midnight IST", () => {
    expect(formatEventWindow("2026-11-27T16:30:00.000Z", "2026-11-27T20:30:00.000Z")).toBe(
      "27 Nov 2026, 22:00 to 28 Nov 2026, 02:00 IST",
    );
  });
});

describe("basisPointsToPercent", () => {
  it("prints whole and fractional percentages", () => {
    expect(basisPointsToPercent(6000)).toBe("60%");
    expect(basisPointsToPercent(250)).toBe("2.50%");
  });
});
