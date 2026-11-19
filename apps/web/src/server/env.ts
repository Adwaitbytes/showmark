import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { AppError, COMMON_ERRORS } from "./errors";

// The only place server code reads process.env (besides the shared chain config owned by the lead).
// Missing optional services resolve to null so pages can render a clear "not configured" state.
// Present but malformed values throw ConfigError, which names the variable and the rule but never the value.

export class ConfigError extends Error {
  constructor(variable: string, rule: string) {
    super(`Environment variable ${variable} is invalid: ${rule}`);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parse<T>(name: string, schema: z.ZodType<T>, rule: string): T | null {
  const raw = read(name);
  if (raw === undefined) return null;
  const result = schema.safeParse(raw);
  if (!result.success) throw new ConfigError(name, rule);
  return result.data;
}

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\/.+/);
const httpsUrl = z.url({ protocol: /^https?$/ }).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://127.0.0.1"));
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v as Hex);

export function databaseUrl(): string | null {
  return parse("DATABASE_URL", postgresUrl, "must be a postgres:// or postgresql:// connection string");
}

export function requireDatabaseUrl(): string {
  const url = databaseUrl();
  if (!url) throw new AppError(503, COMMON_ERRORS.databaseNotConfigured);
  return url;
}

export interface RedisConfig {
  url: string;
  token: string;
}

/** Accepts the Upstash names and the names the Vercel Marketplace integration sets. */
export function redisConfig(): RedisConfig | null {
  const urlName = read("UPSTASH_REDIS_REST_URL") ? "UPSTASH_REDIS_REST_URL" : "KV_REST_API_URL";
  const tokenName = read("UPSTASH_REDIS_REST_TOKEN") ? "UPSTASH_REDIS_REST_TOKEN" : "KV_REST_API_TOKEN";
  const url = parse(urlName, httpsUrl, "must be an https URL");
  const token = parse(tokenName, z.string().min(20), "must be the REST token from the Upstash console");
  if (!url && !token) return null;
  if (!url) throw new ConfigError(urlName, "is required when the Redis token is set");
  if (!token) throw new ConfigError(tokenName, "is required when the Redis URL is set");
  return { url, token };
}

export function relayerPrivateKey(): Hex | null {
  return parse("RELAYER_PRIVATE_KEY", privateKey, "must be 0x followed by 64 hex characters");
}

export function requireRelayerPrivateKey(): Hex {
  const key = relayerPrivateKey();
  if (!key) throw new AppError(503, COMMON_ERRORS.relayerNotConfigured);
  return key;
}

/** HMAC key for session cookies. At least 32 characters of randomness, for example `openssl rand -base64 48`. */
export function sessionSecret(): string {
  const secret = parse("SESSION_SECRET", z.string().min(32), "must be at least 32 characters");
  if (!secret) {
    throw new AppError(503, {
      code: "auth_not_configured",
      message: "Sign in is switched off on this server.",
      action: "Try again later. If this keeps happening, tell the Showmark team.",
    });
  }
  return secret;
}

export function cronSecret(): string | null {
  return parse("CRON_SECRET", z.string().min(16), "must be at least 16 characters");
}

/** Addresses whose campaigns are labelled team-funded on /traction. Comma separated. */
export function teamAddresses(): ReadonlySet<Address> {
  const raw = read("TEAM_ADDRESSES");
  if (!raw) return new Set();
  const out = new Set<Address>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (value === "") continue;
    if (!isAddress(value, { strict: false })) throw new ConfigError("TEAM_ADDRESSES", "must be a comma separated list of addresses");
    out.add(getAddress(value));
  }
  return out;
}

/** Optional override for the QIE ID root registry used for reverse lookups. Mainnet has a default. */
export function qieNameRegistryAddress(): Address | null {
  const value = parse("QIE_NAME_REGISTRY_ADDRESS", z.string().refine((v) => isAddress(v, { strict: false })), "must be an address");
  return value ? getAddress(value) : null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface RelayLimits {
  /** Check-ins per minute from one IP address. INTERFACES section 3 sets 10. */
  perIpPerMinute: number;
  /** Check-ins per minute for one pass. INTERFACES section 3 sets 3. */
  perPassPerMinute: number;
}

/** Venues share one Wi-Fi address, so operators can raise the per-IP limit for an event without a deploy. */
export function relayLimits(): RelayLimits {
  const perIp = parse("RELAY_IP_LIMIT_PER_MINUTE", z.coerce.number().int().min(1).max(10_000), "must be a whole number from 1 to 10000");
  const perPass = parse("RELAY_PASS_LIMIT_PER_MINUTE", z.coerce.number().int().min(1).max(100), "must be a whole number from 1 to 100");
  return { perIpPerMinute: perIp ?? 10, perPassPerMinute: perPass ?? 3 };
}
