import { describe, expect, it } from "vitest";
import {
  formatPlain,
  oraclePriceToNumber,
  parseAmount,
  presencesCovered,
  refundOpensAt,
  SETTLE_GRACE_SECONDS,
  splitPayout,
  usdToNativeWei,
} from "./math";

describe("splitPayout matches CampaignVault._credit", () => {
  it("takes the fee first, then the attendee share of the rest, and gives the organizer the remainder", () => {
    // 2 QUSDC, 2.5% fee, attendee 60%: fee 0.05, net 1.95, attendee 1.17, organizer 0.78
    expect(splitPayout(2_000_000n, 250, 6_000)).toEqual({
      gross: 2_000_000n,
      fee: 50_000n,
      toAttendee: 1_170_000n,
      toOrganizer: 780_000n,
    });
  });

  it("rounds each step down like Solidity, and the organizer absorbs the dust", () => {
    const split = splitPayout(999n, 333, 3_333);
    expect(split.fee).toBe((999n * 333n) / 10_000n);
    const net = 999n - split.fee;
    expect(split.toAttendee).toBe((net * 3_333n) / 10_000n);
    expect(split.fee + split.toAttendee + split.toOrganizer).toBe(999n);
  });

  it("always conserves the gross amount", () => {
    for (const gross of [0n, 1n, 7n, 10n ** 18n + 3n, 123_456_789n]) {
      for (const fee of [0, 1, 250, 500]) {
        for (const share of [0, 1, 5_000, 9_999, 10_000]) {
          const s = splitPayout(gross, fee, share);
          expect(s.fee + s.toAttendee + s.toOrganizer).toBe(gross);
        }
      }
    }
  });

  it("handles the extremes of the attendee share", () => {
    expect(splitPayout(1_000n, 0, 10_000)).toMatchObject({ toAttendee: 1_000n, toOrganizer: 0n });
    expect(splitPayout(1_000n, 0, 0)).toMatchObject({ toAttendee: 0n, toOrganizer: 1_000n });
  });

  it("rejects basis points outside 0 to 10000", () => {
    expect(() => splitPayout(1n, -1, 0)).toThrow(RangeError);
    expect(() => splitPayout(1n, 0, 10_001)).toThrow(RangeError);
    expect(() => splitPayout(1n, 0.5, 0)).toThrow(RangeError);
  });
});

describe("usdToNativeWei matches CampaignVault._quote", () => {
  it("converts 6 decimal USD at an 8 decimal price", () => {
    // $1.00 at $0.16 per QIE = 6.25 QIE
    expect(usdToNativeWei(1_000_000n, 16_000_000n, 8)).toBe(6_250_000_000_000_000_000n);
    // $0.50 at $0.15947567 per QIE
    expect(usdToNativeWei(500_000n, 15_947_567n, 8)).toBe((500_000n * 10n ** 20n) / 15_947_567n);
  });

  it("rounds down", () => {
    // $1 at $3 per QIE = 0.333... QIE
    expect(usdToNativeWei(1_000_000n, 300_000_000n, 8)).toBe(333_333_333_333_333_333n);
  });

  it("defers on a non-positive price or a quote that rounds to zero", () => {
    expect(usdToNativeWei(1_000_000n, 0n, 8)).toBeNull();
    expect(usdToNativeWei(1_000_000n, -5n, 8)).toBeNull();
    expect(usdToNativeWei(0n, 16_000_000n, 8)).toBeNull();
  });

  it("supports other oracle decimals the vault accepts", () => {
    expect(usdToNativeWei(2_000_000n, 2n * 10n ** 18n, 18)).toBe(10n ** 18n);
    expect(() => usdToNativeWei(1n, 1n, 19)).toThrow(RangeError);
  });
});

describe("presencesCovered", () => {
  it("is the deposit divided by the amount per presence, rounded down", () => {
    expect(presencesCovered(500_000_000n, 2_000_000n)).toBe(250n);
    expect(presencesCovered(5_000_001n, 2_000_000n)).toBe(2n);
  });

  it("is zero when nothing can be paid", () => {
    expect(presencesCovered(0n, 1n)).toBe(0n);
    expect(presencesCovered(10n, 0n)).toBe(0n);
  });
});

describe("refundOpensAt", () => {
  it("opens one second after endsAt plus three days, because the vault requires now > endsAt + grace", () => {
    expect(refundOpensAt(1_000)).toBe(1_000 + SETTLE_GRACE_SECONDS + 1);
    expect(SETTLE_GRACE_SECONDS).toBe(259_200);
  });
});

describe("parseAmount and formatPlain", () => {
  it("parses exact decimals", () => {
    expect(parseAmount("2.5", 6)).toBe(2_500_000n);
    expect(parseAmount("1,000", 6)).toBe(1_000_000_000n);
    expect(parseAmount(".25", 6)).toBe(250_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("1", 18)).toBe(10n ** 18n);
  });

  it("rejects malformed input and excess precision", () => {
    for (const bad of ["", "abc", "-1", "1e6", "1.2.3", "0.0000001"]) expect(parseAmount(bad, 6)).toBeNull();
  });

  it("round trips", () => {
    expect(formatPlain(2_500_000n, 6)).toBe("2.5");
    expect(formatPlain(10n ** 18n, 18)).toBe("1");
    expect(formatPlain(0n, 6)).toBe("0");
  });
});

describe("oraclePriceToNumber", () => {
  it("reads an 8 decimal answer", () => {
    expect(oraclePriceToNumber(15_947_567n, 8)).toBeCloseTo(0.15947567, 8);
  });
});
