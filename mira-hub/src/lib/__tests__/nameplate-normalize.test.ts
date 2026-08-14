/**
 * Nameplate recognizer — normalization contract (PRD §10, §29.5).
 * Run: npx vitest run src/lib/__tests__/nameplate-normalize.test.ts
 */
import { describe, expect, it } from "vitest";
import { FixtureRecognizer, normalizeCandidate } from "../nameplate";

describe("normalizeCandidate", () => {
  it("passes through a clean extraction and clamps confidence", () => {
    const c = normalizeCandidate({
      manufacturer: "Allen-Bradley",
      model: "25B-D010N104",
      catalogNumber: "25B-D010N104",
      serialNumber: "XZY123",
      equipmentType: "AC Drive",
      confidence: 1.7,
    });
    expect(c.manufacturer).toBe("Allen-Bradley");
    expect(c.model).toBe("25B-D010N104"); // punctuation preserved exactly
    expect(c.confidence).toBe(1);
  });

  it("treats provider placeholder junk as null — uncertainty is honest", () => {
    const c = normalizeCandidate({
      manufacturer: "unknown",
      model: "  ",
      catalogNumber: "N/A",
      serialNumber: "not visible",
      equipmentType: null,
    });
    expect(c.manufacturer).toBeNull();
    expect(c.model).toBeNull();
    expect(c.catalogNumber).toBeNull();
    expect(c.serialNumber).toBeNull();
    expect(c.equipmentType).toBeNull();
  });

  it("accepts snake_case provider keys", () => {
    const c = normalizeCandidate({ catalog_number: "520-UM001", serial_number: "S1" });
    expect(c.catalogNumber).toBe("520-UM001");
    expect(c.serialNumber).toBe("S1");
  });

  it("caps pathological field lengths and rawText size", () => {
    const c = normalizeCandidate({
      manufacturer: "x".repeat(500),
      rawText: Array.from({ length: 100 }, (_, i) => `t${i}`),
    });
    expect(c.manufacturer?.length).toBe(200);
    expect(c.rawText?.length).toBe(40);
  });
});

describe("FixtureRecognizer", () => {
  it("returns the normalized fixture without any network", async () => {
    const r = new FixtureRecognizer({ manufacturer: "AutomationDirect", model: "GS10", confidence: 0.93 });
    const c = await r.recognize();
    expect(c.manufacturer).toBe("AutomationDirect");
    expect(c.model).toBe("GS10");
    expect(c.confidence).toBe(0.93);
  });
});
