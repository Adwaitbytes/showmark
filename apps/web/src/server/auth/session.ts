import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

// Session cookie: `v1.<base64url(payload)>.<base64url(HMAC-SHA256(payload))>`, keyed by SESSION_SECRET through
// WebCrypto. The payload carries only the address and three times; names are looked up when the session is read.
// Sliding expiry: every authenticated read pushes `exp` out to 15 minutes, never past `max` (12 hours after sign in).

export const SESSION_COOKIE = "sm_session";
export const SESSION_IDLE_SECONDS = 15 * 60;
export const SESSION_MAX_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  /** Checksummed wallet address. */
  address: Address;
  /** Unix seconds when the wallet signed in. */
  issuedAt: number;
  /** Unix seconds when the session ends unless refreshed. */
  expiresAt: number;
  /** Unix seconds after which the session cannot be refreshed. */
  maxAt: number;
}

const payloadSchema = z.object({
  a: z.string().refine((v) => isAddress(v, { strict: false })),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  max: z.number().int().positive(),
});

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const buffer = Buffer.from(text, "base64url");
  const out = new Uint8Array(new ArrayBuffer(buffer.length));
  out.set(buffer);
  return out;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ a: payload.address, iat: payload.issuedAt, exp: payload.expiresAt, max: payload.maxAt })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`v1.${body}`)));
  return `v1.${body}.${toBase64Url(mac)}`;
}

/** Returns the payload when the cookie is authentic and not expired at `now` (unix seconds), otherwise null. */
export async function verifySession(cookie: string | undefined, secret: string, now: number): Promise<SessionPayload | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, macText] = parts;
  const mac = fromBase64Url(macText);
  const raw = fromBase64Url(body);
  if (!mac || !raw) return null;
  // crypto.subtle.verify compares in constant time.
  const authentic = await crypto.subtle.verify("HMAC", await hmacKey(secret), mac, encoder.encode(`v1.${body}`));
  if (!authentic) return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (now >= p.exp || now >= p.max || p.exp > p.max) return null;
  return { address: getAddress(p.a), issuedAt: p.iat, expiresAt: p.exp, maxAt: p.max };
}

export function newSession(address: Address, now: number): SessionPayload {
  return { address, issuedAt: now, expiresAt: now + SESSION_IDLE_SECONDS, maxAt: now + SESSION_MAX_SECONDS };
}

/** The same session with its idle expiry pushed out, capped at the absolute maximum. */
export function slide(session: SessionPayload, now: number): SessionPayload {
  return { ...session, expiresAt: Math.min(now + SESSION_IDLE_SECONDS, session.maxAt) };
}

export function sessionCookieHeader(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, maxAgeSeconds)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
