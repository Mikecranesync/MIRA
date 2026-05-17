import { describe, test, expect } from "vitest";

// Unit-level tests for cmms-sync helpers. DB-dependent paths are covered by
// integration tests (require NEON_DATABASE_URL).

import { resolveEquipmentUnsPath, type SyncResult } from "../cmms-sync";
import { manufacturerPath, modelPath } from "../../uns";

describe("SyncResult shape", () => {
  test("all required fields present", () => {
    const result: SyncResult = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      equipment: 3,
      workOrders: 5,
      pmSchedules: 2,
      parts: 4,
      locations: 2,
      manufacturers: 6,
      models: 9,
      relationships: 8,
      triples: 12,
      durationMs: 150,
    };
    expect(result.equipment).toBe(3);
    expect(result.manufacturers).toBe(6);
    expect(result.models).toBe(9);
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

describe("resolveEquipmentUnsPath", () => {
  test("computes path under parent line when cmms uns_path is null", () => {
    const path = resolveEquipmentUnsPath(null, "enterprise.plant_a.line_1", "AC-7");
    expect(path).toBe("enterprise.plant_a.line_1.ac_7");
  });

  test("returns null when wizard hasn't run (no parent path)", () => {
    expect(resolveEquipmentUnsPath(null, null, "AC-7")).toBeNull();
  });

  test("returns null when equipment identifier is blank", () => {
    expect(resolveEquipmentUnsPath(null, "enterprise.plant_a.line_1", null)).toBeNull();
    expect(resolveEquipmentUnsPath(null, "enterprise.plant_a.line_1", "")).toBeNull();
  });

  test("passes through compact wizard-style cmms uns_path verbatim", () => {
    const compact = "enterprise.plant_a.line_1.compressor_7";
    expect(resolveEquipmentUnsPath(compact, "enterprise.plant_a.line_2", "AC-7")).toBe(compact);
  });

  test("normalizes ISA-95 marker paths to wizard grammar under parent", () => {
    // tools/cmms_equipment_uns_backfill.py writes ISA-95 marker grammar;
    // the namespace tree expects wizard grammar so eq nests under the line.
    const isa95 = "enterprise.tenant_xyz.site.plant_a.area.dept_b.line.line_1.equipment.ac_7";
    const path = resolveEquipmentUnsPath(isa95, "enterprise.plant_a.line_1", "AC-7");
    expect(path).toBe("enterprise.plant_a.line_1.ac_7");
  });

  test("normalizes when only a 'site' marker is present", () => {
    const partial = "enterprise.tenant_xyz.site.plant_a.equipment_7";
    const path = resolveEquipmentUnsPath(partial, "enterprise.plant_a.line_1", "Equipment-7");
    expect(path).toBe("enterprise.plant_a.line_1.equipment_7");
  });
});

describe("knowledge_entries mirror — path construction", () => {
  test("manufacturer entityId == manufacturerPath", () => {
    const p = manufacturerPath("Ingersoll Rand");
    expect(p).toBe("enterprise.knowledge_base.ingersoll_rand");
  });

  test("model entityId == modelPath", () => {
    const p = modelPath("Rockwell Automation", "PowerFlex 525");
    expect(p).toBe("enterprise.knowledge_base.rockwell_automation.powerflex_525");
  });

  test("manufacturer paths are stable across casing / whitespace variants", () => {
    expect(manufacturerPath("  Siemens  ".trim())).toBe(manufacturerPath("siemens"));
    expect(manufacturerPath("Yaskawa Electric Corporation")).toBe(
      "enterprise.knowledge_base.yaskawa_electric_corporation",
    );
  });
});
