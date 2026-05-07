import { describe, test, expect } from "vitest";
import { sanitizeLabel } from "../uns-backfill";

describe("sanitizeLabel", () => {
  test("lowercases", () => {
    expect(sanitizeLabel("PlantA", "x")).toBe("planta");
  });

  test("replaces spaces and punctuation with underscore", () => {
    expect(sanitizeLabel("Zone A-2 (south)", "x")).toBe("zone_a_2_south");
  });

  test("collapses runs of underscores", () => {
    expect(sanitizeLabel("a___b", "x")).toBe("a_b");
  });

  test("trims leading and trailing underscores", () => {
    expect(sanitizeLabel("--abc--", "x")).toBe("abc");
  });

  test("falls back when input would be empty", () => {
    expect(sanitizeLabel("", "fallback")).toBe("fallback");
    expect(sanitizeLabel("---", "fallback")).toBe("fallback");
  });

  test("preserves digits and underscores", () => {
    expect(sanitizeLabel("Line_3", "x")).toBe("line_3");
  });

  test("ltree-safe output", () => {
    const cases = ["Plant — Lake Wales!", "Stardust Racers v2.0", "Área:01"];
    for (const c of cases) {
      const out = sanitizeLabel(c, "fallback");
      expect(out).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
