// The door QR changes every 15 seconds. Rotations are aligned to chain time, so two door screens at the same event
// change their codes at the same moment and the countdown means the same thing on both.

export const ROTATION_MS = 15_000;

/** Start (ms, chain time) of the rotation that contains `nowMs`. */
export function rotationStart(nowMs: number): number {
  return Math.floor(nowMs / ROTATION_MS) * ROTATION_MS;
}

/** Milliseconds until the next code, between 1 and ROTATION_MS. */
export function msUntilNextRotation(nowMs: number): number {
  const into = ((nowMs % ROTATION_MS) + ROTATION_MS) % ROTATION_MS;
  return ROTATION_MS - into;
}

/** Whole seconds shown on the countdown: 15 right after a rotation, 1 just before the next. */
export function secondsLeft(nowMs: number): number {
  return Math.ceil(msUntilNextRotation(nowMs) / 1000);
}

/** issuedAt for a pass signed at `nowMs` chain time. Seconds, rounded down so it is never in the future. */
export function issuedAtFor(nowMs: number): bigint {
  return BigInt(Math.floor(nowMs / 1000));
}

export type CheckInWindow = "before" | "open" | "closed";

/** Check-in opens 1 hour before startsAt and closes 1 hour after endsAt (ShowmarkRegistry.WINDOW_SLACK). */
export const WINDOW_SLACK_SECONDS = 3600n;

export function checkInWindow(nowSeconds: bigint, startsAt: bigint, endsAt: bigint): CheckInWindow {
  if (nowSeconds + WINDOW_SLACK_SECONDS < startsAt) return "before";
  if (nowSeconds > endsAt + WINDOW_SLACK_SECONDS) return "closed";
  return "open";
}

/**
 * How long a door key stays valid. The registry compares validUntil with the signed door time, and door times are
 * only accepted up to endsAt + 1 hour, so that is all a key ever needs. Shorter than the 3 day maximum on purpose.
 */
export function doorKeyValidUntil(endsAt: bigint): bigint {
  return endsAt + WINDOW_SLACK_SECONDS;
}
