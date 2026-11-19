import { postCheckIn, type ApiResult, type Submitted } from "./api";
import { classifyDoorCode, doorTokenFromPath } from "./door-fragment";
import { saveToOutbox } from "./local-records";
import { passAndSign, type SignResult } from "./pass-signer";

// The check-in starts the moment the check-in screen's code runs in the browser, before React has
// hydrated anything: decode the door code from the address bar, sign, keep the signed check-in on the
// phone, and send it. The signing code is a static import on purpose: as a dynamic import it was a
// second round trip after the page's scripts (about 250 ms on throttled 4G); now it downloads with
// them. A broken link pays for it (about 22 kB) so that every real check-in is faster. The screen
// then adopts this attempt instead of starting its own, so hydration, the event lookup and effects
// are no longer on the critical path.

export interface EarlyCheckIn {
  /** `{token}#{fragment}` this attempt was made for; the screen only adopts a matching one. */
  code: string;
  signed: Promise<SignResult>;
  /** The first POST, or null when signing failed. Adopted at most once by a screen that stays mounted. */
  post: Promise<ApiResult<Submitted> | null>;
  adopted: boolean;
}

let early: EarlyCheckIn | null = null;

/** Starts the check-in for the door code in the address bar, once per page load. */
export function startEarlyCheckIn(): void {
  if (typeof window === "undefined" || early) return;
  const token = doorTokenFromPath(window.location.pathname);
  const fragment = window.location.hash.slice(1);
  if (!token || !fragment) return;
  const code = classifyDoorCode(token, fragment);
  if (code.status !== "ok") return;

  const signed: Promise<SignResult> = passAndSign(code.door).catch((): SignResult => ({ ok: false, reason: "sign" }));
  const post = signed.then((result) => {
    if (!result.ok) return null;
    // Saved before it leaves, so closing the tab mid-send still leaves something to resend.
    saveToOutbox({ request: result.request, eventName: null, savedAt: Date.now() });
    return postCheckIn(result.request, { keepalive: true });
  });
  early = { code: `${token}#${fragment}`, signed, post, adopted: false };
}

/** The early attempt for this door code, if one was started. */
export function earlyCheckInFor(token: string, fragment: string): EarlyCheckIn | null {
  return early && early.code === `${token}#${fragment}` ? early : null;
}

/** Test hook. */
export function resetEarlyCheckIn(): void {
  early = null;
}
