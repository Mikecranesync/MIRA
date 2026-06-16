import { describe, expect, it } from "vitest";
import { ASSET_TAG_REGEX, generateAssetTag, validateAssetTag } from "../asset-tag";

describe("generateAssetTag", () => {
  it("emits values that pass the validator", () => {
    for (let i = 0; i < 100; i++) {
      const tag = generateAssetTag();
      expect(ASSET_TAG_REGEX.test(tag)).toBe(true);
      expect(validateAssetTag(tag).ok).toBe(true);
    }
  });

  it("derives a manufacturer prefix when usable", () => {
    expect(generateAssetTag({ manufacturer: "Allen-Bradley" })).toMatch(/^ALLE-[0-9A-Z]{8}$/);
    expect(generateAssetTag({ manufacturer: "ABB" })).toMatch(/^ABB-[0-9A-Z]{8}$/);
  });

  it("falls back to EQ when manufacturer is missing or unusable", () => {
    expect(generateAssetTag()).toMatch(/^EQ-[0-9A-Z]{8}$/);
    expect(generateAssetTag({ manufacturer: null })).toMatch(/^EQ-[0-9A-Z]{8}$/);
    expect(generateAssetTag({ manufacturer: "!" })).toMatch(/^EQ-[0-9A-Z]{8}$/);
  });

  it("does not collide trivially across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateAssetTag());
    expect(seen.size).toBe(1000);
  });
});
