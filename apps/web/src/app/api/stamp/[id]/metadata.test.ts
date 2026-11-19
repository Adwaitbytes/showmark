import { describe, expect, it } from "vitest";
import { sampleEvent } from "@/ui/__fixtures__";
import { parseTokenId, stampMetadata } from "./metadata";

describe("parseTokenId", () => {
  it("accepts decimal ids and the 64 character hex form", () => {
    expect(parseTokenId("12")).toBe("12");
    expect(parseTokenId("000000000000000000000000000000000000000000000000000000000000000c")).toBe("12");
  });

  it("rejects zero, negatives, padding and junk", () => {
    for (const bad of ["0", "-1", "012", "1.5", "0x0c", "abc", "", "1e3"]) expect(parseTokenId(bad)).toBeNull();
    expect(parseTokenId("0".repeat(64))).toBeNull();
  });
});

describe("stampMetadata", () => {
  it("follows the ERC-1155 metadata shape with an SVG image", () => {
    const meta = stampMetadata(sampleEvent, "https://showmark.app");
    expect(meta.name).toBe("Showmark stamp: Sample builders meetup");
    expect(meta.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(meta.external_url).toBe("https://showmark.app/e/12");
    expect(meta.attributes).toContainEqual({ trait_type: "City", value: "Bengaluru" });
    expect(meta.attributes).toContainEqual({ trait_type: "Series position", value: 4, display_type: "number" });
    expect(meta.description).not.toMatch(/[–—]/);
  });
});
