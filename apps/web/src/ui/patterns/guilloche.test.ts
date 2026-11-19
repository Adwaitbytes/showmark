import { describe, expect, it } from "vitest";
import { guillocheGeometry } from "./guilloche";

const ALICE = "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b";
const BOB = "0x2F9d41aE7b3C5e8D1a6F0b4C9e2D7a5B3c1E8f06";

describe("guillocheGeometry", () => {
  it("draws the same pattern for the same address in any case", () => {
    expect(guillocheGeometry(ALICE, "rosette")).toEqual(guillocheGeometry(ALICE.toLowerCase(), "rosette"));
    expect(guillocheGeometry(ALICE, "band")).toEqual(guillocheGeometry(ALICE.toLowerCase(), "band"));
  });

  it("draws a different pattern for a different address", () => {
    const a = guillocheGeometry(ALICE, "rosette");
    const b = guillocheGeometry(BOB, "rosette");
    expect(a.layers.map((l) => l.d)).not.toEqual(b.layers.map((l) => l.d));
  });

  it("keeps paths compact and well formed", () => {
    for (const variant of ["rosette", "band"] as const) {
      const geometry = guillocheGeometry(ALICE, variant);
      for (const layer of geometry.layers) {
        expect(layer.d.startsWith("M")).toBe(true);
        expect(layer.d).not.toMatch(/NaN|Infinity/);
        expect(layer.transforms.length).toBeGreaterThan(0);
      }
      const bytes = geometry.layers.reduce((sum, l) => sum + l.d.length, 0);
      expect(bytes).toBeLessThan(60_000);
    }
  });
});
