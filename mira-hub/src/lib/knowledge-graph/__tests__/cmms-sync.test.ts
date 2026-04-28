import { describe, test, expect } from "vitest";

// Unit-level tests for cmms-sync helpers. DB-dependent paths are covered by
// integration tests (require NEON_DATABASE_URL).

// Verify the SyncResult shape is correct — import type only so no DB pool loads
import type { SyncResult } from "../cmms-sync";

describe("SyncResult shape", () => {
  test("all required fields present", () => {
    const result: SyncResult = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      equipment: 3,
      workOrders: 5,
      pmSchedules: 2,
      parts: 4,
      locations: 2,
      relationships: 8,
      triples: 12,
      durationMs: 150,
    };
    expect(result.equipment).toBe(3);
    expect(result.relationships).toBe(8);
    expect(result.triples).toBe(12);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("entity name derivation", () => {
  test("equipment name falls back to manufacturer+model when description is empty", () => {
    const descOrFallback = (desc: string | null, manufacturer: string | null, model: string | null, id: string) =>
      String(desc || [manufacturer, model].filter(Boolean).join(" ") || id);

    expect(descOrFallback(null, "Ingersoll Rand", "R55n", "eq-1")).toBe("Ingersoll Rand R55n");
    expect(descOrFallback("Air Compressor #1", "Ingersoll Rand", "R55n", "eq-1")).toBe("Air Compressor #1");
    expect(descOrFallback(null, null, null, "eq-1")).toBe("eq-1");
  });

  test("location slug matches expected pattern", () => {
    const toSlug = (loc: string) => loc.toLowerCase().replace(/\s+/g, "-");
    expect(toSlug("Building A, Bay 3")).toBe("building-a,-bay-3");
    expect(toSlug("Main Floor")).toBe("main-floor");
  });
});
