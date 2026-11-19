import type { Address, Hex } from "viem";

// A few hundred bytes of response validation for the attendee app. zod/mini cost about 23 kB
// gzipped, which landed on phones right after a stamp; these combinators check the same shapes.
// Each reader returns the cleaned value, or FAIL. Objects keep only the declared keys.

export const FAIL: unique symbol = Symbol("invalid");
export type Reader<T> = (value: unknown) => T | typeof FAIL;

export const str: Reader<string> = (v) => (typeof v === "string" ? v : FAIL);
export const num: Reader<number> = (v) => (typeof v === "number" && Number.isFinite(v) ? v : FAIL);
export const bool: Reader<boolean> = (v) => (typeof v === "boolean" ? v : FAIL);
export const digits: Reader<string> = (v) => (typeof v === "string" && /^\d+$/.test(v) ? v : FAIL);
export const hex: Reader<Hex> = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? (v as Hex) : FAIL);
export const address: Reader<Address> = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : FAIL);

export function oneOf<const T extends readonly (string | number)[]>(...options: T): Reader<T[number]> {
  return (v) => (options.includes(v as T[number]) ? (v as T[number]) : FAIL);
}

export function nullable<T>(read: Reader<T>): Reader<T | null> {
  return (v) => (v === null ? null : read(v));
}

export function array<T>(read: Reader<T>): Reader<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return FAIL;
    const out: T[] = [];
    for (const item of v) {
      const value = read(item);
      if (value === FAIL) return FAIL;
      out.push(value);
    }
    return out;
  };
}

export function object<S extends Record<string, Reader<unknown>>>(shape: S): Reader<{ [K in keyof S]: Exclude<ReturnType<S[K]>, typeof FAIL> }> {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return FAIL;
    const source = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const value = shape[key](source[key]);
      if (value === FAIL) return FAIL;
      out[key] = value;
    }
    return out as { [K in keyof S]: Exclude<ReturnType<S[K]>, typeof FAIL> };
  };
}

/** Adapts a reader to the API client's parser contract (null for a malformed body). */
export function toParser<T>(read: Reader<T>): (body: unknown) => T | null {
  return (body) => {
    const value = read(body);
    return value === FAIL ? null : value;
  };
}
