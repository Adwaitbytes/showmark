"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: unknown;
  /** True until the first answer (data or error) arrives. */
  loading: boolean;
  refresh(): void;
}

/**
 * Runs `load` now and every `intervalMs` while the tab is visible. Keeps the last good data when a later poll fails,
 * so a dropped request does not blank the screen; the error is still reported for a banner.
 * `key` restarts polling from scratch when it changes. Pass null to stop.
 */
export function usePoll<T>(key: string | null, load: () => Promise<T>, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(key !== null);
  const loadRef = useRef(load);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(run, intervalMs);
        return;
      }
      try {
        const next = await loadRef.current();
        if (cancelled) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (intervalMs > 0) timer = setTimeout(run, intervalMs);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, intervalMs, tick]);

  return { data, error, loading, refresh };
}
