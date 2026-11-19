import type { PassStorage } from "@/lib/wallet/pass";

/** Same contract as the pass storage, so tests can hand every module one in-memory store. */
export type KeyValueStorage = PassStorage;

/** localStorage when the browser allows it. Safari private mode and some in-app browsers throw on access. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readJson(storage: KeyValueStorage | null, key: string): unknown {
  const raw = storage?.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Writes JSON and reports whether it stuck. A full or blocked store must not break a check-in. */
export function writeJson(storage: KeyValueStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
