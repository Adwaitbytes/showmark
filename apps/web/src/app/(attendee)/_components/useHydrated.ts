"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => undefined;

/**
 * False on the server and during hydration, true after. Lets a component read this phone's
 * localStorage (the pass, saved check-ins) during render without a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
