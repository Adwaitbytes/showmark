import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ApiError } from "@/lib/api/types";
import { ConfigError } from "./env";
import { AppError, COMMON_ERRORS, RELAY_ERRORS, type ErrorCopy } from "./errors";
import type { RateLimiter } from "./kv";
import { log } from "./log";

// Shared plumbing for route handlers: JSON bodies with a size cap, zod validation, the ApiError shape, cache
// headers, client IP and rate limits.

export type CachePolicy =
  | { kind: "no-store" }
  | { kind: "private" }
  /** Shared caches (Vercel CDN) keep it `sMaxAge` seconds and may serve it stale while refreshing. */
  | { kind: "public"; sMaxAge: number; staleWhileRevalidate: number }
  | { kind: "immutable" };

export const CACHE = {
  noStore: { kind: "no-store" },
  private: { kind: "private" },
  live: { kind: "public", sMaxAge: 5, staleWhileRevalidate: 30 },
  traction: { kind: "public", sMaxAge: 30, staleWhileRevalidate: 300 },
  quote: { kind: "public", sMaxAge: 10, staleWhileRevalidate: 20 },
  immutable: { kind: "immutable" },
} as const satisfies Record<string, CachePolicy>;

export function cacheControl(policy: CachePolicy): string {
  switch (policy.kind) {
    case "no-store":
      return "no-store";
    case "private":
      return "private, no-store";
    case "public":
      return `public, max-age=0, s-maxage=${policy.sMaxAge}, stale-while-revalidate=${policy.staleWhileRevalidate}`;
    case "immutable":
      return "public, max-age=31536000, immutable";
  }
}

export function json(body: unknown, options: { status?: number; cache?: CachePolicy; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: { "cache-control": cacheControl(options.cache ?? CACHE.noStore), ...options.headers },
  });
}

export function errorJson(status: number, copy: ErrorCopy, headers: Record<string, string> = {}): Response {
  const body: ApiError = { error: { code: copy.code, message: copy.message, action: copy.action } };
  return json(body, { status, headers });
}

/** Turns anything thrown inside a handler into the ApiError shape. Unexpected errors are logged, never leaked. */
export function errorResponse(error: unknown, route: string): Response {
  if (error instanceof AppError) {
    if (error.status >= 500) log.warn("api.error", { route, status: error.status, code: error.copy.code, cause: error.cause });
    return errorJson(error.status, error.copy, error.headers);
  }
  if (error instanceof ConfigError) {
    log.error("api.config_error", { route, error });
    return errorJson(503, COMMON_ERRORS.internal);
  }
  log.error("api.unhandled", { route, error });
  return errorJson(500, COMMON_ERRORS.internal);
}

/** Runs a handler and maps thrown errors to responses. */
export async function handle(route: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    // Next signals "this route is dynamic, stop prerendering" by throwing; swallowing it would bake an error
    // response into the build as a static page.
    unstable_rethrow(error);
    return errorResponse(error, route);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export function invalid(issues?: z.core.$ZodIssue[]): AppError {
  const first = issues?.[0];
  const where = first?.path.length ? ` The field ${first.path.join(".")} is not valid.` : "";
  return new AppError(400, { ...RELAY_ERRORS.invalidRequest, message: `${RELAY_ERRORS.invalidRequest.message}${where}` });
}

export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new AppError(413, RELAY_ERRORS.bodyTooLarge);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError(413, RELAY_ERRORS.bodyTooLarge);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues);
  return parsed.data;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid(parsed.error.issues);
  return parsed.data;
}

/** The caller's IP. On Vercel the edge overwrites x-forwarded-for and sets x-real-ip, so neither can be spoofed. */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

export async function enforceLimit(limiter: RateLimiter, identifier: string, copy: ErrorCopy): Promise<void> {
  const result = await limiter.limit(identifier);
  if (result.success) return;
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  throw new AppError(429, copy, { headers: { "retry-after": String(retryAfter) } });
}
