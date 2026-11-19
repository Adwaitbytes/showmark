import type { KeyValueStore } from "./kv";

/** A held lock. `token` proves ownership so a holder whose lock expired cannot release someone else's. */
export interface Lock {
  key: string;
  token: string;
  /** Pushes the expiry out again. Returns false when the lock was lost (expired and taken by someone else). */
  extend(ttlMs: number): Promise<boolean>;
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
  return {
    key,
    token,
    extend: (ms) => kv.extendIfEquals(key, token, ms),
    release: async () => {
      await kv.deleteIfEquals(key, token);
    },
  };
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
