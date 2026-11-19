import "server-only";

import { isAppError } from "@/server/errors";

export type Loaded<T> = { ok: true; data: T } | { ok: false; message: string; action: string };

/**
 * Runs a query and turns the server's deliberate errors (AppError, whose copy is written for
 * people) into a value the page can render. Anything unexpected is rethrown so the nearest
 * <SectionBoundary> or error.tsx shows a generic, safe message.
 */
export async function load<T>(query: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await query() };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.copy.message, action: error.copy.action };
    throw error;
  }
}
