import { describe, expect, it } from "vitest";
import { extractAssetTag, buildScanRoute } from "../scan-target";

describe("extractAssetTag", () => {
  it("extracts a tag from the canonical app.factorylm.com URL", () => {
    expect(extractAssetTag("https://app.factorylm.com/m/VFD-07")).toBe("VFD-07");
  });

  it("strips query strings and fragments", () => {
    expect(extractAssetTag("https://app.factorylm.com/m/PUMP-03?ref=label")).toBe("PUMP-03");
    expect(extractAssetTag("https://app.factorylm.com/m/COMP-01#section")).toBe("COMP-01");
  });

  it("accepts path-only form", () => {
    expect(extractAssetTag("/m/VFD-07")).toBe("VFD-07");
    expect(extractAssetTag("m/VFD-07")).toBe("VFD-07");
  });

  it("accepts a raw asset tag (hand-typed fallback)", () => {
    expect(extractAssetTag("VFD-07")).toBe("VFD-07");
    expect(extractAssetTag("EQ-9X4K2P7Q")).toBe("EQ-9X4K2P7Q");
  });

  it("trims whitespace", () => {
    expect(extractAssetTag("  VFD-07  ")).toBe("VFD-07");
  });

  it("decodes percent-encoded tags", () => {
    expect(extractAssetTag("https://app.factorylm.com/m/VFD%2D07")).toBe("VFD-07");
  });

  it("rejects a URL that doesn't point at an asset", () => {
    expect(extractAssetTag("https://app.factorylm.com/feed")).toBeNull();
    expect(extractAssetTag("https://example.com/")).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(extractAssetTag("")).toBeNull();
    expect(extractAssetTag("   ")).toBeNull();
  });

  it("rejects tags containing path-traversal characters", () => {
    // ASSET_TAG_REGEX only allows alnum + underscore + dash; a tag like
    // "../etc" or one containing slashes/dots must not pass through.
    expect(extractAssetTag("../etc")).toBeNull();
    expect(extractAssetTag("https://app.factorylm.com/m/..%2Fetc")).toBeNull();
    expect(extractAssetTag("foo.bar")).toBeNull();
  });

  it("rejects tags that exceed the 64-char limit", () => {
    const tooLong = "A".repeat(65);
    expect(extractAssetTag(tooLong)).toBeNull();
  });
});

describe("buildScanRoute", () => {
  it("defaults to the asset mobile page when there is no returnTo", () => {
    expect(buildScanRoute(null, "VFD-07")).toBe("/m/VFD-07");
    expect(buildScanRoute(undefined, "VFD-07")).toBe("/m/VFD-07");
    expect(buildScanRoute("", "VFD-07")).toBe("/m/VFD-07");
  });

  it("returns the scanned tag to a safe internal returnTo (New Work Order flow)", () => {
    expect(buildScanRoute("/workorders/new", "QA-CMMS-SS-214546")).toBe(
      "/workorders/new?assetTag=QA-CMMS-SS-214546",
    );
  });

  it("percent-encodes the tag in the returnTo query", () => {
    expect(buildScanRoute("/workorders/new", "A B")).toBe("/workorders/new?assetTag=A%20B");
  });

  it("rejects open-redirect targets and falls back to /m/<tag>", () => {
    expect(buildScanRoute("https://evil.com", "VFD-07")).toBe("/m/VFD-07");
    expect(buildScanRoute("//evil.com", "VFD-07")).toBe("/m/VFD-07");
    expect(buildScanRoute("/workorders/new?x=1", "VFD-07")).toBe("/m/VFD-07");
    expect(buildScanRoute("javascript:alert(1)", "VFD-07")).toBe("/m/VFD-07");
  });
});
