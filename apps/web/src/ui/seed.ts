/**
 * Deterministic randomness for generative marks. The same seed string always yields the same
 * sequence on the server, in the browser and inside the /api/stamp route, so a passport's
 * guilloche and a stamp's tilt never change between renders.
 */

/** 32-bit FNV-1a over UTF-16 code units, case-insensitive so checksummed and lowercase addresses agree. */
export function hashSeed(input: string): number {
  const text = input.toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** One element of a non-empty list. */
  pick<T>(items: readonly [T, ...T[]]): T;
}

/** mulberry32: tiny, fast and good enough for visual variety. Not for anything security related. */
export function createRng(seed: string | number): Rng {
  let state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] ?? items[0],
  };
}

/** Rounds to one decimal place for compact SVG path output. */
export function r1(value: number): number {
  return Math.round(value * 10) / 10;
}
