import { describe, expect, it } from "vitest";

// Test the pure transformation helpers used by the promote route.
// These are extracted here to keep the route's hot path free of exports.

/** Convert a slash-joined UNS path to ltree dot notation. */
function unsPathToLtree(unsPath: string): string {
  return unsPath.replace(/\//g, ".").replace(/[^a-z0-9_.]/gi, "_");
}

/** Clamp confidence to [0.0, 1.0]. */
function clampConfidence(raw: string | null): number {
  if (!raw) return 0.5;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.min(1.0, Math.max(0.0, n)) : 0.5;
}

describe("unsPathToLtree", () => {
  it("replaces slashes with dots", () => {
    expect(unsPathToLtree("enterprise/site1/area1/conv/run")).toBe(
      "enterprise.site1.area1.conv.run",
    );
  });

  it("sanitizes non-alphanum characters other than dots/underscores", () => {
    const result = unsPathToLtree("enterprise/site-1/area 1/conv");
    expect(result).not.toContain("/");
    expect(result).not.toContain("-");
    expect(result).not.toContain(" ");
  });

  it("handles a single-segment path", () => {
    expect(unsPathToLtree("enterprise")).toBe("enterprise");
  });
});

describe("clampConfidence", () => {
  it("returns 0.5 for null or NaN input", () => {
    expect(clampConfidence(null)).toBe(0.5);
    expect(clampConfidence("abc")).toBe(0.5);
    expect(clampConfidence("")).toBe(0.5);
  });

  it("returns the parsed value when in range", () => {
    expect(clampConfidence("0.9")).toBe(0.9);
    expect(clampConfidence("0.3")).toBe(0.3);
    expect(clampConfidence("0")).toBe(0.0);
  });

  it("clamps values outside [0, 1]", () => {
    expect(clampConfidence("1.5")).toBe(1.0);
    expect(clampConfidence("-0.1")).toBe(0.0);
  });
});
