"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { parsePassKey, PASS_STORAGE_KEY } from "./pass-key";
import { browserStorage, STORAGE_CHANGED_EVENT } from "./storage";

// Reading this phone's storage as a React store. Next keeps visited routes mounted but hidden
// (Activity), so a screen that read storage once on mount kept showing what was there on its first
// visit: open /pass before your first check-in, check in, tap "Open my passport", and the old
// "no pass" (or a stalled load) came back. A store is re-read whenever Showmark writes and whenever a
// hidden screen is shown again, because React re-checks the snapshot when it re-subscribes.

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(STORAGE_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(STORAGE_CHANGED_EVENT, listener);
  };
}

function read(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * The raw stored value for `key`. `undefined` during the server render and hydration, when storage
 * cannot be read yet; `null` when nothing is stored. Use the value as a dependency for parsing.
 */
export function useStoredItem(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => undefined,
  );
}

/** This phone's pass address: `undefined` until hydrated, `null` when the phone has no pass yet. */
export function usePassAddress(): Address | null | undefined {
  const raw = useStoredItem(PASS_STORAGE_KEY);
  return useMemo(() => {
    if (raw === undefined) return undefined;
    const key = parsePassKey(raw);
    return key ? privateKeyToAddress(key) : null;
  }, [raw]);
}
