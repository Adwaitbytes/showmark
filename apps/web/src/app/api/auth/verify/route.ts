import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Session } from "@/lib/api/types";
import { activeChainId } from "@/lib/chain/chains";
import { newSession, sessionCookieHeader, signSession } from "@/server/auth/session";
import { verifySignIn } from "@/server/auth/signin";
import { chainContext } from "@/server/chain";
import { sessionSecret } from "@/server/env";
import { RELAY_ERRORS } from "@/server/errors";
import { CACHE, clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { getStore, rateLimiter } from "@/server/kv";
import { log } from "@/server/log";
import { nameOf } from "@/server/qie/names";
import { walletSignature } from "@/server/schemas";

const bodySchema = z.object({ message: z.string().min(1).max(4_000), signature: walletSignature });

/** Verifies the signed sign-in message and starts a session (httpOnly cookie, 15 minute sliding, 12 hour max). */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("auth.verify", async () => {
    await enforceLimit(rateLimiter("auth-ip", 20, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const secret = sessionSecret();
    const body = await readJson(request, bodySchema);
    const now = new Date();
    const address = await verifySignIn(getStore(), chainContext().client, {
      message: body.message,
      signature: body.signature,
      domain: request.nextUrl.host,
      chainId: activeChainId,
      now,
    });
    const session = newSession(address, Math.floor(now.getTime() / 1000));
    let qieName: string | null = null;
    try {
      qieName = await nameOf(address);
    } catch (error) {
      // A name is decoration; sign in still succeeds without it.
      log.warn("auth.name_lookup_failed", { address, error });
    }
    const response: Session = { address, qieName, expiresAt: new Date(session.expiresAt * 1000).toISOString() };
    log.info("auth.signed_in", { address });
    return json(response, {
      cache: CACHE.private,
      headers: { "set-cookie": sessionCookieHeader(await signSession(session, secret), session.expiresAt - session.issuedAt) },
    });
  });
}
