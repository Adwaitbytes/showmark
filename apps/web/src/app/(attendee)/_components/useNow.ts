"use client";

import { useEffect, useState } from "react";

/**
 * The current time, ticking every `intervalMs` while `active`. Used for retry countdowns.
 * Pass a `key` (the retry deadline) to read the clock again as soon as it changes.
 */
export function useNow(active: boolean, key: unknown = null, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active, key, intervalMs]);
  return now;
}
