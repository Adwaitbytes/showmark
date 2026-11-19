import type { KeyValueStore } from "./kv";

/** A held lock. `token` proves ownership so a holder whose lock expired cannot release someone else's. */
export interface Lock {
  key: string;
  token: string;
  /** Pushes the expiry out again. Returns false when the lock was lost (expired and taken by someone else). */
  extend(ttlMs: number): Promise<boolean>;
  /** Unix ms when the lock was taken or last extended, so holders skip a Redis round trip when it is fresh. */
  refreshedAt: number;
  release(): Promise<void>;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `SET key token NX PX ttl`. Returns null when another holder has it. */
export async function tryLock(kv: KeyValueStore, key: string, ttlMs: number): Promise<Lock | null> {
  const token = randomToken();
  const acquired = await kv.set(key, token, { nx: true, px: ttlMs });
  if (!acquired) return null;
  const lock: Lock = {
    key,
    token,
    refreshedAt: Date.now(),
    extend: async (ms) => {
      const ok = await kv.extendIfEquals(key, token, ms);
      if (ok) lock.refreshedAt = Date.now();
      return ok;
    },
    release: async () => {
      await kv.deleteIfEquals(key, token);
    },
  };
  return lock;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls for the lock until `waitMs` passes. */
export async function waitForLock(kv: KeyValueStore, key: string, ttlMs: number, waitMs: number, pollMs = 50): Promise<Lock | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = await tryLock(kv, key, ttlMs);
    if (lock || Date.now() >= deadline) return lock;
    await sleep(pollMs);
  }
}
