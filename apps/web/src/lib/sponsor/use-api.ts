"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { ApiRequestError, apiGet } from "./api";
import type { PlainError } from "./errors";

export type ApiState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null; refreshing: boolean }
  | { status: "error"; data: T | null; error: PlainError & { httpStatus: number } };

export interface UseApiOptions {
  /** Re-read every n milliseconds while the tab is visible. Keeps "verified reach, live" honest. */
  pollMs?: number;
}

/**
 * Reads one validated /api resource. Keeps the last good data on a failed refresh so a flaky network never blanks
 * a screen, and pauses polling in background tabs.
 */
export function useApi<T extends z.ZodType>(url: string | null, schema: T, options: UseApiOptions = {}) {
  const [state, setState] = useState<ApiState<z.output<T>>>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const schemaRef = useRef(schema);
  const dataRef = useRef<z.output<T> | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function read(background: boolean) {
      if (background && dataRef.current !== null) {
        setState({ status: "ready", data: dataRef.current, error: null, refreshing: true });
      }
      try {
        const data = await apiGet(url as string, schemaRef.current, { signal: controller.signal });
        dataRef.current = data;
        setState({ status: "ready", data, error: null, refreshing: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        const copy =
          error instanceof ApiRequestError
            ? { ...error.copy, httpStatus: error.status }
            : { message: "This could not be read just now.", action: "Try again in a moment.", httpStatus: 0 };
        setState({ status: "error", data: dataRef.current, error: copy });
      }
      if (options.pollMs && !controller.signal.aborted) {
        timer = setTimeout(function tick() {
          if (document.visibilityState === "visible") void read(true);
          else timer = setTimeout(tick, options.pollMs);
        }, options.pollMs);
      }
    }

    void read(false);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url, nonce, options.pollMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
