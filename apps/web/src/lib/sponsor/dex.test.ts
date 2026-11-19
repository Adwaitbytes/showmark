import { getAddress } from "viem";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
const SPONSOR = getAddress("0xA8C849C243BA940102d2deB99971e4c713411926");

type DexModule = typeof import("./dex");
let dex: DexModule;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1990");
  vi.resetModules();
  dex = await import("./dex");
});

function swap(overrides: Record<string, unknown> = {}, tx: Record<string, unknown> = {}) {
  return dex.swapSchema.parse({
    chainId: 1990,
    tradeType: "exactOut",
    amountIn: "61289011062747460712",
    amountOut: "10000000",
    maxAmountIn: "61901901173374935320",
    slippageBps: 100,
    priceImpactPct: 0.21,
    totalCostPct: 0.51,
    pathSymbols: ["QIE", "QUSDC"],
    warnings: [],
    quotedAt: 1795076515,
    recipient: SPONSOR.toLowerCase(),
    tx: { to: ROUTER.toLowerCase(), data: "0xfb3bdb41", value: "0x35b0a1bcf0b4c4c18", chainId: 1990, ...tx },
    ...overrides,
  });
}

describe("verifySwap", () => {
  const maxValue = 61_901_901_173_374_935_320n;

  it("accepts the router transaction QIEDEX builds for this sponsor", () => {
    const call = dex.verifySwap(swap(), SPONSOR, 10_000_000n, maxValue);
    expect(call.to).toBe(getAddress(ROUTER));
    expect(call.value).toBe(BigInt("0x35b0a1bcf0b4c4c18"));
  });

  it("refuses a transaction to anything but the QIEDEX router", () => {
    expect(() => dex.verifySwap(swap({}, { to: SPONSOR }), SPONSOR, 10_000_000n, maxValue)).toThrow(/router/);
  });

  it("refuses a swap that pays someone else", () => {
    expect(() => dex.verifySwap(swap({ recipient: ROUTER }), SPONSOR, 10_000_000n, maxValue)).toThrow(/recipient/);
  });

  it("refuses a swap that spends more QIE than the quote allowed", () => {
    expect(() => dex.verifySwap(swap(), SPONSOR, 10_000_000n, 1n)).toThrow(/more QIE/);
  });

  it("refuses a swap for another chain or a smaller amount", () => {
    expect(() => dex.verifySwap(swap({}, { chainId: 1 }), SPONSOR, 10_000_000n, maxValue)).toThrow(/chain/);
    expect(() => dex.verifySwap(swap(), SPONSOR, 20_000_000n, maxValue)).toThrow(/less QUSDC/);
  });
});
