import { AppError } from "./errors";
import { log } from "./log";

/** Every chain read and explorer call on the page path gives up after this, so a page never hangs on an RPC. */
export const READ_TIMEOUT_MS = 5_000;

export class ReadTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} took longer than ${ms} ms`);
    this.name = "ReadTimeoutError";
  }
}

export const CHAIN_SLOW = {
  code: "chain_slow",
  message: "The QIE network is answering slowly right now.",
  action: "Try again in a minute.",
} as const;

export function chainSlow(cause: unknown): AppError {
  return new AppError(503, CHAIN_SLOW, { cause });
}

/**
 * Resolves with `work` or rejects with ReadTimeoutError after `ms`. The underlying request keeps running (viem
 * reads cannot be aborted); its late outcome is logged at debug level rather than left unhandled.
 */
export function withTimeout<T>(work: Promise<T>, label: string, ms: number = READ_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadTimeoutError(label, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
    work.catch((error: unknown) => log.debug("read.late_failure", { label, error }));
  });
}

export function isTimeout(error: unknown): boolean {
  return error instanceof ReadTimeoutError;
}
