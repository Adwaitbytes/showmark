import { describe, expect, it } from "vitest";
import { createRng, hashSeed } from "./seed";

describe("hashSeed", () => {
  it("is stable and ignores address case", () => {
    expect(hashSeed("0xAbC")).toBe(hashSeed("0xabc"));
    expect(hashSeed("showmark")).toBe(hashSeed("showmark"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
});

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng("0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b");
    const b = createRng("0x7ae3b1c9d4f20a8e6b5c3d1f9a2e4b6c8d0f1a3b");
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("stays inside the requested bounds", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      const real = rng.range(-2, 2);
      expect(real).toBeGreaterThanOrEqual(-2);
      expect(real).toBeLessThan(2);
    }
  });
});
