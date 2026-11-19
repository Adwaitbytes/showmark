import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { AppError, COMMON_ERRORS, type ErrorCopy } from "../errors";
import type { KeyValueStore } from "../kv";

// Proxy for the public QIEDEX quote API (https://api.dex.qie.digital/openapi.json, v0.2.0). Parameters mirror
// GET /quote. The upstream allows 60 quote requests per minute per IP, and every Showmark user shares our server
// IP, so answers are cached briefly and upstream calls are capped globally.

export const DEX_API = "https://api.dex.qie.digital";
const NATIVE_ALIASES = new Set(["qie", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
const CACHE_MS = 10_000;
const TIMEOUT_MS = 8_000;

const token = z
  .string()
  .trim()
  .refine((v) => NATIVE_ALIASES.has(v.toLowerCase()) || isAddress(v, { strict: false }), "must be QIE or a token address")
  .transform((v) => (NATIVE_ALIASES.has(v.toLowerCase()) ? "QIE" : getAddress(v)));
const rawAmount = z.string().regex(/^[0-9]{1,78}$/);
const decimalAmount = z.string().regex(/^[0-9]{1,40}(\.[0-9]{1,40})?$/);
const bool = z.enum(["true", "false"]);

export const dexQuoteQuerySchema = z
  .object({
    tokenIn: token,
    tokenOut: token,
    amountIn: rawAmount.optional(),
    amountOut: rawAmount.optional(),
    amountInDecimal: decimalAmount.optional(),
    amountOutDecimal: decimalAmount.optional(),
    slippageBps: z.coerce.number().int().min(0).max(5_000).optional(),
    feeOnTransfer: bool.optional(),
    allowUnverifiedHops: bool.optional(),
  })
  .strict()
  .refine((q) => [q.amountIn, q.amountOut, q.amountInDecimal, q.amountOutDecimal].filter((a) => a !== undefined).length === 1, {
    message: "give exactly one of amountIn, amountOut, amountInDecimal, amountOutDecimal",
  });
export type DexQuoteQuery = z.output<typeof dexQuoteQuerySchema>;

/** The fields Showmark relies on; everything else the API returns is passed through unchanged. */
export const dexQuoteSchema = z.looseObject({
  chainId: z.number(),
  tokenIn: z.looseObject({ address: z.string(), symbol: z.string(), decimals: z.number() }),
  tokenOut: z.looseObject({ address: z.string(), symbol: z.string(), decimals: z.number() }),
  amountIn: z.string(),
  amountOut: z.string(),
  minAmountOut: z.string(),
  path: z.array(z.string()),
  priceImpactPct: z.number(),
  warnings: z.array(z.unknown()),
  quotedAt: z.number(),
});
export type DexQuote = z.output<typeof dexQuoteSchema>;

export const DEX_ERRORS = {
  badRequest: {
    code: "dex_bad_request",
    message: "QIEDEX could not quote this pair or amount.",
    action: "Check both tokens and the amount, then try again.",
  },
  noRoute: {
    code: "dex_no_route",
    message: "QIEDEX has no route between these two tokens.",
    action: "Pick a different token, or swap through QIE first.",
  },
  busy: {
    code: "dex_busy",
    message: "Price quotes are busy right now.",
    action: "Try again in a minute.",
  },
} as const satisfies Record<string, ErrorCopy>;

export function quoteUrl(query: DexQuoteQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  params.sort();
  return `${DEX_API}/quote?${params.toString()}`;
}

/** Cached for 10 seconds per exact query. `beforeUpstream` runs only on a cache miss (the global rate limit). */
export async function dexQuote(query: DexQuoteQuery, kv: KeyValueStore, beforeUpstream: () => Promise<void>, fetchImpl: typeof fetch = fetch): Promise<DexQuote> {
  const url = quoteUrl(query);
  const key = `dex:quote:${url}`;
  const cached = await kv.get(key);
  if (cached) return dexQuoteSchema.parse(JSON.parse(cached));

  await beforeUpstream();
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  if (response.status === 400) throw new AppError(400, DEX_ERRORS.badRequest);
  if (response.status === 404) throw new AppError(404, DEX_ERRORS.noRoute);
  if (response.status === 429) throw new AppError(503, DEX_ERRORS.busy, { headers: { "retry-after": response.headers.get("retry-after") ?? "30" } });
  if (!response.ok) throw new AppError(503, COMMON_ERRORS.upstream, { cause: new Error(`QIEDEX answered ${response.status}`) });

  const parsed = dexQuoteSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError(503, COMMON_ERRORS.upstream, { cause: parsed.error });
  await kv.set(key, JSON.stringify(parsed.data), { px: CACHE_MS });
  return parsed.data;
}
