import type { NextRequest } from "next/server";
import { RELAY_ERRORS } from "@/server/errors";
import { CACHE, clientIp, enforceLimit, handle, json, parseWith } from "@/server/http";
import { getStore, rateLimiter } from "@/server/kv";
import { DEX_ERRORS, dexQuote, dexQuoteQuerySchema } from "@/server/qie/dex";
import { searchParamsObject } from "@/server/schemas";

/** Proxies QIEDEX GET /quote (same query parameters) with a 10 second cache and rate limits. Mainnet prices only. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("dex.quote", async () => {
    await enforceLimit(rateLimiter("dex-ip", 20, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const query = parseWith(dexQuoteQuerySchema, searchParamsObject(request.nextUrl.searchParams));
    const quote = await dexQuote(query, getStore(), () => enforceLimit(rateLimiter("dex-upstream", 50, "1 m"), "all", DEX_ERRORS.busy));
    return json(quote, { cache: CACHE.quote });
  });
}
