import type { ApiError } from "@/lib/api/types";

/** User-facing error copy. `message` says what happened, `action` says what to do next. */
export interface ErrorCopy {
  code: string;
  message: string;
  action: string;
}

/**
 * The one error type the server throws on purpose. Route handlers turn it into the `ApiError` shape with
 * `status`; server components can catch it and render `copy` directly.
 */
export class AppError extends Error {
  readonly status: number;
  readonly copy: ErrorCopy;

  constructor(status: number, copy: ErrorCopy, options?: { cause?: unknown }) {
    super(`${copy.code}: ${copy.message}`, options);
    this.name = "AppError";
    this.status = status;
    this.copy = copy;
  }

  toBody(): ApiError {
    return { error: { code: this.copy.code, message: this.copy.message, action: this.copy.action } };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export const COMMON_ERRORS = {
  databaseNotConfigured: {
    code: "database_not_configured",
    message: "Showmark cannot reach its database right now.",
    action: "Try again in a few minutes. If this keeps happening, tell the Showmark team.",
  },
  redisNotConfigured: {
    code: "queue_not_configured",
    message: "Showmark cannot reach its queue service right now.",
    action: "Try again in a few minutes. If this keeps happening, tell the Showmark team.",
  },
  relayerNotConfigured: {
    code: "relayer_not_configured",
    message: "Gasless check-in is switched off on this server.",
    action: "Try again later, or ask the organizer to tell the Showmark team.",
  },
  notDeployed: {
    code: "not_deployed",
    message: "The Showmark contracts are not deployed on this network yet.",
    action: "Check back once the contracts are live.",
  },
  upstream: {
    code: "upstream_unavailable",
    message: "A service Showmark depends on did not answer in time.",
    action: "Try again in a few seconds.",
  },
  internal: {
    code: "internal_error",
    message: "Something went wrong on our side.",
    action: "Try again. If it happens again, tell the Showmark team what you were doing.",
  },
} as const satisfies Record<string, ErrorCopy>;
