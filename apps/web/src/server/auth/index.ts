import { cookies } from "next/headers";
import { sessionSecret } from "../env";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";

/**
 * The signed-in wallet for the current request, or null. For server components and route handlers in other
 * workstreams. This does not slide the expiry (server components cannot set cookies); clients keep the session
 * alive through GET /api/auth/session.
 */
export async function currentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, sessionSecret(), Math.floor(Date.now() / 1000));
}
