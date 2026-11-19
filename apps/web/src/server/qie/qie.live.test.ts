import { createPublicClient, http, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { qieMainnet } from "@/lib/chain/chains";
import { MAINNET_QIE_NAME_REGISTRY, MAINNET_QIE_PAID_NAME_REGISTRY, type ChainContext } from "../chain";
import { MemoryStore } from "../kv";
import { chainTransactionsToday, hadActivityBefore } from "./blockscout";
import { dexQuote, dexQuoteQuerySchema } from "./dex";
import { addressOf, holdsQieId, nameOf } from "./names";

// Runs against QIE mainnet. Skipped unless RUN_LIVE_TESTS=1, because CI should not depend on public RPCs.
// The holder below minted pjjjw35673.qie at block 12005798 and sent its first transaction at block 12006014.
const live = process.env.RUN_LIVE_TESTS === "1";
const holder: Address = "0x395215ab5Dde403801868fa850b89e305F01725E";
const explorer = "https://mainnet.qie.digital/api/v2";

function mainnetContext(): ChainContext {
  return {
    chainId: 1990,
    client: createPublicClient({ chain: qieMainnet, transport: http("https://rpc1mainnet.qie.digital") }),
    registry: zeroAddress,
    vault: zeroAddress,
    bond: zeroAddress,
    qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
    oracle: "0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17",
    nameRegistry: MAINNET_QIE_NAME_REGISTRY,
    paidNameRegistry: MAINNET_QIE_PAID_NAME_REGISTRY,
    deployBlock: 0n,
  };
}

describe.skipIf(!live)("QIE mainnet (live)", () => {
  const deps = { ctx: mainnetContext(), kv: new MemoryStore() };

  it("resolves a QIE ID name in both directions", async () => {
    expect(await addressOf("pjjjw35673.qie", deps)).toBe(holder);
    expect(await addressOf("PJJJW35673", deps)).toBe(holder);
    expect(await nameOf(holder, deps)).toBe("pjjjw35673.qie");
    expect(await holdsQieId(holder, deps)).toBe(true);
    expect(await addressOf("showmark-name-that-does-not-exist.qie", deps)).toBeNull();
    expect(await nameOf("0x000000000000000000000000000000000000dEaD", deps)).toBeNull();
    expect(await holdsQieId("0x000000000000000000000000000000000000dEaD", deps)).toBe(false);
  });

  it("reads explorer activity before a block and the daily transaction count", async () => {
    expect(await hadActivityBefore(holder, 12_005_798n, fetch, explorer)).toBe(false);
    expect(await hadActivityBefore(holder, 12_006_015n, fetch, explorer)).toBe(true);
    expect(await chainTransactionsToday(fetch, explorer)).toBeGreaterThan(0);
  });

  it("quotes QIE to QUSDC through the QIEDEX proxy", async () => {
    const query = dexQuoteQuerySchema.parse({ tokenIn: "QIE", tokenOut: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", amountInDecimal: "1" });
    const quote = await dexQuote(query, new MemoryStore(), async () => {});
    expect(quote.chainId).toBe(1990);
    expect(quote.tokenOut.symbol).toBe("QUSDC");
    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
  });
});
