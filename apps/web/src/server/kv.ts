import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { redisConfig, isProduction } from "./env";
import { AppError, COMMON_ERRORS } from "./errors";
import { log } from "./log";

// A narrow key-value interface over Upstash Redis. The relayer, locks, caches and rate limits only use these
// operations, which lets tests run the exact same code against the in-memory implementation below.

export interface SetOptions {
  /** Only set when the key does not exist (SET NX). */
  nx?: boolean;
  /** Expiry in milliseconds (SET PX). */
  px?: number;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  /** Returns true when the value was written (false when NX found an existing key). */
  set(key: string, value: string, options?: SetOptions): Promise<boolean>;
  getdel(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  rpush(key: string, values: string[]): Promise<number>;
  /** Pops up to `count` items from the head. */
  lpop(key: string, count: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  /** Atomically deletes `key` when it currently holds `expected`. */
  deleteIfEquals(key: string, expected: string): Promise<boolean>;
  /** Atomically resets the expiry of `key` when it currently holds `expected`. */
  extendIfEquals(key: string, expected: string, px: number): Promise<boolean>;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix ms when the window frees a slot. */
  reset: number;
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

const DELETE_IF_EQUALS = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const EXTEND_IF_EQUALS = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

export class UpstashStore implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string) {
    return this.redis.get<string>(key);
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    const result =
      options.px !== undefined
        ? options.nx
          ? await this.redis.set(key, value, { px: options.px, nx: true })
          : await this.redis.set(key, value, { px: options.px })
        : options.nx
          ? await this.redis.set(key, value, { nx: true })
          : await this.redis.set(key, value);
    return result === "OK";
  }

  async getdel(key: string) {
    return this.redis.getdel<string>(key);
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async rpush(key: string, values: string[]) {
    return this.redis.rpush(key, ...values);
  }

  async lpop(key: string, count: number) {
    const result = await this.redis.lpop<string[]>(key, count);
    return result ?? [];
  }

  async llen(key: string) {
    return this.redis.llen(key);
  }

  async deleteIfEquals(key: string, expected: string) {
    const result = await this.redis.eval<[string], number>(DELETE_IF_EQUALS, [key], [expected]);
    return Number(result) === 1;
  }

  async extendIfEquals(key: string, expected: string, px: number) {
    const result = await this.redis.eval<[string, string], number>(EXTEND_IF_EQUALS, [key], [expected, String(px)]);
    return Number(result) === 1;
  }
}

interface MemoryEntry {
  value: string | string[];
  expiresAt: number | null;
}

/** Single-process store with the same semantics. Used by tests and by local development without Upstash. */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, MemoryEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): MemoryEntry | undefined {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private string(key: string): string | null {
    const entry = this.live(key);
    if (!entry) return null;
    if (typeof entry.value !== "string") throw new Error(`WRONGTYPE ${key} holds a list`);
    return entry.value;
  }

  private list(key: string): string[] {
    const entry = this.live(key);
    if (!entry) return [];
    if (typeof entry.value === "string") throw new Error(`WRONGTYPE ${key} holds a string`);
    return entry.value;
  }

  async get(key: string) {
    return this.string(key);
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    if (options.nx && this.live(key)) return false;
    this.data.set(key, { value, expiresAt: options.px !== undefined ? this.now() + options.px : null });
    return true;
  }

  async getdel(key: string) {
    const value = this.string(key);
    this.data.delete(key);
    return value;
  }

  async del(key: string) {
    this.data.delete(key);
  }

  async rpush(key: string, values: string[]) {
    const entry = this.live(key);
    const list = this.list(key);
    list.push(...values);
    this.data.set(key, { value: list, expiresAt: entry?.expiresAt ?? null });
    return list.length;
  }

  async lpop(key: string, count: number) {
    const list = this.list(key);
    const out = list.splice(0, count);
    if (list.length === 0) this.data.delete(key);
    return out;
  }

  async llen(key: string) {
    return this.list(key).length;
  }

  async deleteIfEquals(key: string, expected: string) {
    if (this.string(key) !== expected) return false;
    this.data.delete(key);
    return true;
  }

  async extendIfEquals(key: string, expected: string, px: number) {
    if (this.string(key) !== expected) return false;
    this.data.set(key, { value: expected, expiresAt: this.now() + px });
    return true;
  }
}

/** Sliding-log limiter for tests and local development. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly tokens: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async limit(identifier: string): Promise<RateLimitResult> {
    const now = this.now();
    const recent = (this.hits.get(identifier) ?? []).filter((t) => t > now - this.windowMs);
    const success = recent.length < this.tokens;
    if (success) recent.push(now);
    this.hits.set(identifier, recent);
    return { success, remaining: Math.max(0, this.tokens - recent.length), reset: (recent[0] ?? now) + this.windowMs };
  }
}

let store: KeyValueStore | null = null;
let rawRedis: Redis | null = null;
let warnedMemory = false;

function upstashClient(): Redis | null {
  if (rawRedis) return rawRedis;
  const config = redisConfig();
  if (!config) return null;
  rawRedis = new Redis({ url: config.url, token: config.token, enableTelemetry: false });
  return rawRedis;
}

/**
 * The shared store. Uses Upstash when configured. Outside production it falls back to memory so the app runs
 * locally without credentials; in production a missing Redis is an error, because locks must be shared.
 */
export function getStore(): KeyValueStore {
  if (store) return store;
  const config = redisConfig();
  if (config) {
    store = new UpstashStore(new Redis({ url: config.url, token: config.token, automaticDeserialization: false, enableTelemetry: false }));
    return store;
  }
  if (isProduction()) throw new AppError(503, COMMON_ERRORS.redisNotConfigured);
  if (!warnedMemory) {
    log.warn("kv.memory_fallback", { reason: "UPSTASH_REDIS_REST_URL is not set; locks and rate limits are per process" });
    warnedMemory = true;
  }
  store = new MemoryStore();
  return store;
}

export function setStore(next: KeyValueStore | null): void {
  store = next;
}

type Window = `${number} s` | `${number} m`;

function windowMs(window: Window): number {
  const [n, unit] = window.split(" ");
  return Number(n) * (unit === "m" ? 60_000 : 1_000);
}

const limiters = new Map<string, RateLimiter>();

/** A named sliding-window limiter, for example `rateLimiter("checkin-ip", 10, "1 m")`. */
export function rateLimiter(name: string, tokens: number, window: Window): RateLimiter {
  const key = `${name}:${tokens}:${window}`;
  const existing = limiters.get(key);
  if (existing) return existing;
  const redis = upstashClient();
  let limiter: RateLimiter;
  if (redis) {
    const upstash = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `rl:${name}`, analytics: false, timeout: 2_000 });
    limiter = { limit: async (id) => upstash.limit(id) };
  } else {
    if (isProduction()) throw new AppError(503, COMMON_ERRORS.redisNotConfigured);
    limiter = new MemoryRateLimiter(tokens, windowMs(window));
  }
  limiters.set(key, limiter);
  return limiter;
}

export function resetRateLimiters(): void {
  limiters.clear();
}
