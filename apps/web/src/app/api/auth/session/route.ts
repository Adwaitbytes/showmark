import type { NextRequest } from "next/server";
import type { Session } from "@/lib/api/types";
import { clearSessionCookieHeader, SESSION_COOKIE, sessionCookieHeader, signSession, slide, verifySession } from "@/server/auth/session";
import { sessionSecret } from "@/server/env";
import { AppError, AUTH_ERRORS } from "@/server/errors";
import { CACHE, handle, json } from "@/server/http";
import { log } from "@/server/log";
import { nameOf } from "@/server/qie/names";

/** The current session. Each call slides the idle expiry forward by 15 minutes, up to 12 hours after sign in. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("auth.session", async () => {
    const secret = sessionSecret();
    const now = Math.floor(Date.now() / 1000);
    const current = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret, now);
    if (!current) throw new AppError(401, AUTH_ERRORS.unauthorized, { headers: { "set-cookie": clearSessionCookieHeader() } });
    const next = slide(current, now);
    let qieName: string | null = null;
    try {
      qieName = await nameOf(current.address);
    } catch (error) {
      log.warn("auth.name_lookup_failed", { address: current.address, error });
    }
    const body: Session = { address: current.address, qieName, expiresAt: new Date(next.expiresAt * 1000).toISOString() };
    return json(body, { cache: CACHE.private, headers: { "set-cookie": sessionCookieHeader(await signSession(next, secret), next.expiresAt - now) } });
  });
}

/** Signs out by clearing the cookie. */
export async function DELETE(): Promise<Response> {
  return json({ signedOut: true }, { cache: CACHE.private, headers: { "set-cookie": clearSessionCookieHeader() } });
}
