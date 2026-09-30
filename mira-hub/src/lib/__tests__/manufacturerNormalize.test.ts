import { describe, expect, it } from "vitest";
import { manufacturerInGroup, manufacturerSearchNames, normalizeManufacturer } from "../manufacturerNormalize";

describe("normalizeManufacturer", () => {
  it("collapses known OCR variants to the canonical name (alias)", () => {
    expect(normalizeManufacturer("Alien-Bradley")).toEqual({
      canonical: "Rockwell Automation",
      method: "alias",
    });
    expect(normalizeManufacturer("Cofemo")).toEqual({
      canonical: "Coffing",
      method: "alias",
    });
    expect(normalizeManufacturer("Orldndo Rigging")).toEqual({
      canonical: "Orlando Rigging",
      method: "alias",
    });
    expect(normalizeManufacturer("Deshaco")).toEqual({
      canonical: "Deshazo",
      method: "alias",
    });
  });

  it("matches alias keys case-insensitively", () => {
    expect(normalizeManufacturer("alien-bradley")).toEqual({
      canonical: "Rockwell Automation",
      method: "alias",
    });
    expect(normalizeManufacturer("ALIEN-BRADLEY")).toEqual({
      canonical: "Rockwell Automation",
      method: "alias",
    });
  });

  it("matches alias keys with collapsed internal whitespace", () => {
    expect(normalizeManufacturer("alien   bradley")).toEqual({
      canonical: "Rockwell Automation",
      method: "alias",
    });
  });

  it("passes unknown vendors through unchanged (identity), preserving casing", () => {
    expect(normalizeManufacturer("Acme Hoist")).toEqual({
      canonical: "Acme Hoist",
      method: "identity",
    });
  });

  it("collapses whitespace on identity passthrough", () => {
    expect(normalizeManufacturer("  Orlando   Rigging  ")).toEqual({
      canonical: "Orlando Rigging",
      method: "identity",
    });
  });

  it("returns empty canonical for null/undefined/blank", () => {
    expect(normalizeManufacturer(null)).toEqual({ canonical: "", method: "identity" });
    expect(normalizeManufacturer(undefined)).toEqual({ canonical: "", method: "identity" });
    expect(normalizeManufacturer("")).toEqual({ canonical: "", method: "identity" });
    expect(normalizeManufacturer("   ")).toEqual({ canonical: "", method: "identity" });
  });
});

describe("manufacturerSearchNames (#4068 same-family fallback)", () => {
  it("an Allen-Bradley notebook searches the whole Rockwell alias group", () => {
    const names = manufacturerSearchNames("Allen-Bradley");
    expect(names).toContain("allen-bradley");
    expect(names).toContain("rockwell");
    // "rockwell automation" is covered by the "rockwell" substring needle.
    expect(names).not.toContain("rockwell automation");
  });

  it("a Rockwell Automation notebook also reaches Allen-Bradley rows", () => {
    expect(manufacturerSearchNames("Rockwell Automation")).toContain("allen-bradley");
  });

  it("an unknown vendor searches only its own name", () => {
    expect(manufacturerSearchNames("Baykon")).toEqual(["baykon"]);
  });

  it("blank input searches nothing", () => {
    expect(manufacturerSearchNames("  ")).toEqual([]);
  });
});

describe("manufacturerInGroup (Codex #4069 pass 24 F2)", () => {
  it.each([
    ["SEW-EURODRIVE GmbH", "SEW-Eurodrive", true],
    ["SEW", "SEW-Eurodrive", true],
    ["Rockwell Automation", "Allen-Bradley", true],
    ["Allen-Bradley", "Rockwell Automation", true],
    ["Sewon", "SEW-Eurodrive", false],
    ["Rockwellington Pumps", "Allen-Bradley", false],
    ["Baykon", "Baykon", true],
    ["Baykonix", "Baykon", false],
  ])("%s belongs to %s's vendor group: %s", (stored, bound, expected) => {
    expect(manufacturerInGroup(stored, bound)).toBe(expected);
  });
});
