"use client";

import { useEffect, useState } from "react";

/**
 * The current time, ticking every `intervalMs` while `active`. Used for retry countdowns.
 * Pass a `key` (the retry deadline) to read the clock again as soon as it changes.
 */
export function useNow(active: boolean, key: unknown = null, intervalMs = 1000): number {
  // 0 until the first tick: the clock is never read during render, so a prerender stays deterministic.
  const [now, setNow] = useState(0);
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
