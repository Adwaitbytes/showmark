import type { NextRequest } from "next/server";
import { z } from "zod";
import { activeChainId } from "@/lib/chain/chains";
import { createChallenge } from "@/server/auth/signin";
import { RELAY_ERRORS } from "@/server/errors";
import { CACHE, clientIp, enforceLimit, handle, json, parseWith } from "@/server/http";
import { getStore, rateLimiter } from "@/server/kv";
import { addressSchema, searchParamsObject } from "@/server/schemas";

const querySchema = z.object({ address: addressSchema });

/** `?address=0x..` returns the exact sign-in message for the wallet to sign, with a single-use nonce. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("auth.nonce", async () => {
    await enforceLimit(rateLimiter("auth-ip", 20, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const { address } = parseWith(querySchema, searchParamsObject(request.nextUrl.searchParams));
    const challenge = await createChallenge(getStore(), {
      address,
      domain: request.nextUrl.host,
      uri: request.nextUrl.origin,
      chainId: activeChainId,
      now: new Date(),
    });
    return json(challenge, { cache: CACHE.private });
  });
}
