import { describe, expect, it } from "vitest";
import { qualityToI3x } from "@/lib/i3x/quality";

// §4.1 of docs/architecture/i3x-aligned-ingestion-and-context-model.md
describe("qualityToI3x — MIRA quality/freshness → i3X VQT quality", () => {
  it("maps fresh good to Good", () => {
    expect(qualityToI3x({ quality: "good", freshness: "live", hasValue: true })).toBe("Good");
  });

  it("maps bad to Bad", () => {
    expect(qualityToI3x({ quality: "bad", freshness: "live", hasValue: true })).toBe("Bad");
  });

  it("maps uncertain to Uncertain", () => {
    expect(qualityToI3x({ quality: "uncertain", freshness: "live", hasValue: true })).toBe("Uncertain");
  });

  it("maps MIRA stale quality to Uncertain", () => {
    expect(qualityToI3x({ quality: "stale", freshness: "live", hasValue: true })).toBe("Uncertain");
  });

  it("downgrades good to Uncertain when freshness_status is stale", () => {
    expect(qualityToI3x({ quality: "good", freshness: "stale", hasValue: true })).toBe("Uncertain");
  });

  it("returns GoodNoData when the object is known but carries no value", () => {
    expect(qualityToI3x({ quality: "good", freshness: "live", hasValue: false })).toBe("GoodNoData");
  });

  it("a bad reading with no value is still Bad (bad-ness dominates absence)", () => {
    expect(qualityToI3x({ quality: "bad", freshness: "live", hasValue: false })).toBe("Bad");
  });

  it("tolerates unknown/empty quality codes by downgrading to Uncertain", () => {
    expect(qualityToI3x({ quality: "weird", freshness: "live", hasValue: true })).toBe("Uncertain");
    expect(qualityToI3x({ quality: "", freshness: "live", hasValue: true })).toBe("Uncertain");
  });

  it("defaults hasValue to true and freshness to live when omitted", () => {
    expect(qualityToI3x({ quality: "good" })).toBe("Good");
  });
});
