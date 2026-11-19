import { describe, expect, it } from "vitest";
import * as shared from "@/lib/chain/eip712";
import { assertNotMainnet, checkInTypes, doorPassTypes, percentile, summarize } from "./loadtest";

describe("load test script", () => {
  it("uses the same EIP-712 types as the app", () => {
    expect(checkInTypes).toEqual(shared.checkInTypes);
    expect(doorPassTypes).toEqual(shared.doorPassTypes);
  });

  it("refuses QIE mainnet", () => {
    expect(() => assertNotMainnet(1990, "server")).toThrow(/Refusing to run/);
    expect(() => assertNotMainnet(1983, "server")).not.toThrow();
  });

  it("reports percentiles, failures and the batching factor", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 99)).toBe(10);
    const report = summarize(
      [
        { ms: 100, status: 200, code: "ok", txHash: "0xa" },
        { ms: 200, status: 200, code: "ok", txHash: "0xa" },
        { ms: 300, status: 429, code: "rate_limited", txHash: null },
      ],
      1_000,
    );
    expect(report).toMatchObject({ requests: 3, succeeded: 2, failed: 1, failures: { "429 rate_limited": 1 }, transactions: 1, checkInsPerTransaction: 2 });
    expect(report.latencyMs.p50).toBe(200);
  });
});
