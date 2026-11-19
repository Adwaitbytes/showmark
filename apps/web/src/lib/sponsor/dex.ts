import { getAddress, isAddress, isAddressEqual, isHex, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { addresses } from "@/lib/chain/addresses";
import { activeChainId } from "@/lib/chain/chains";
import { apiGet } from "./api";

// Funding a QUSDC campaign from native QIE through QIEDEX (mainnet only). Quotes go through Showmark's cached,
// rate-limited proxy; the unsigned swap comes from the public QIEDEX API, and is only sent after checking that it
// calls the official router on this chain, pays the sponsor, and spends no more QIE than the quote allows.

export const QIEDEX_API = "https://api.dex.qie.digital";
/** Price impact above this is called out as expensive (Phase 0: the only QIE/QUSDC pool is thin). */
export const HIGH_IMPACT_PCT = 3;
export const DEFAULT_SLIPPAGE_BPS = 100;

export function dexAvailable(): boolean {
  return activeChainId === 1990 && addresses.dexRouter !== zeroAddress && addresses.qusdc !== zeroAddress;
}

const uint = z.string().regex(/^\d+$/).transform((v) => BigInt(v));

const warningSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "danger"]),
  message: z.string(),
});

export const quoteSchema = z.object({
  chainId: z.number(),
  tradeType: z.enum(["exactIn", "exactOut"]),
  amountIn: uint,
  amountOut: uint,
  maxAmountIn: uint.optional(),
  minAmountOut: uint.optional(),
  slippageBps: z.number().int(),
  priceImpactPct: z.number(),
  totalCostPct: z.number(),
  pathSymbols: z.array(z.string()),
  router: z.string().nullable().optional(),
  warnings: z.array(warningSchema).default([]),
  quotedAt: z.number(),
});
export type DexQuote = z.output<typeof quoteSchema>;

const txRequestSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.string(),
  chainId: z.number(),
});

export const swapSchema = quoteSchema.extend({
  recipient: z.string(),
  tx: txRequestSchema,
});
export type DexSwap = z.output<typeof swapSchema>;

function params(qusdcOut: bigint, slippageBps: number, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    tokenIn: "QIE",
    tokenOut: addresses.qusdc,
    amountOut: qusdcOut.toString(),
    slippageBps: String(slippageBps),
    ...extra,
  }).toString();
}

/** How much QIE buys exactly `qusdcOut` QUSDC right now. */
export function fetchQuote(qusdcOut: bigint, slippageBps: number, signal?: AbortSignal): Promise<DexQuote> {
  return apiGet(`/api/dex/quote?${params(qusdcOut, slippageBps)}`, quoteSchema, { signal, cache: "no-store" });
}

export interface SwapCall {
  to: Address;
  data: Hex;
  value: bigint;
  quote: DexSwap;
}

export class UnsafeSwapError extends Error {
  constructor(reason: string) {
    super(`QIEDEX returned a swap Showmark will not send: ${reason}`);
    this.name = "UnsafeSwapError";
  }
}

/** Checks an unsigned QIEDEX swap before it ever reaches the wallet. Exported for tests. */
export function verifySwap(swap: DexSwap, recipient: Address, qusdcOut: bigint, maxValue: bigint): SwapCall {
  if (swap.tx.chainId !== activeChainId) throw new UnsafeSwapError("wrong chain");
  if (!isAddress(swap.tx.to) || !isAddressEqual(getAddress(swap.tx.to), addresses.dexRouter)) throw new UnsafeSwapError("not the QIEDEX router");
  if (!isAddress(swap.recipient) || !isAddressEqual(getAddress(swap.recipient), recipient)) throw new UnsafeSwapError("wrong recipient");
  if (swap.amountOut < qusdcOut) throw new UnsafeSwapError("buys less QUSDC than asked");
  if (!isHex(swap.tx.data) || !isHex(swap.tx.value)) throw new UnsafeSwapError("malformed transaction");
  const value = BigInt(swap.tx.value);
  if (value > maxValue) throw new UnsafeSwapError("spends more QIE than the quote allowed");
  return { to: getAddress(swap.tx.to), data: swap.tx.data, value, quote: swap };
}

/** Builds the swap that buys exactly `qusdcOut` QUSDC for `recipient`, spending at most `maxValue` wei. */
export async function buildSwap(recipient: Address, qusdcOut: bigint, slippageBps: number, maxValue: bigint): Promise<SwapCall> {
  const url = `${QIEDEX_API}/swap?${params(qusdcOut, slippageBps, { recipient, from: recipient, deadline: "600" })}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new UnsafeSwapError(`QIEDEX answered ${response.status}`);
  const swap = swapSchema.parse(await response.json());
  return verifySwap(swap, recipient, qusdcOut, maxValue);
}
