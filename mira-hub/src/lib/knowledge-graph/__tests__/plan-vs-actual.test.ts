import { describe, test, expect } from "vitest";
import { classifyMismatch, formatPmMismatchLine, type PmMismatch } from "../plan-vs-actual";
import { formatMaintenanceContext } from "../context-builder";
import type { MaintenanceContext } from "../traversal";

describe("classifyMismatch", () => {
  test("returns null below the minimum occurrence floor", () => {
    expect(classifyMismatch(2, 30, 90)).toBeNull();
    expect(classifyMismatch(1, 30, 90)).toBeNull();
  });

  test("returns null when MTBF or interval is missing", () => {
    expect(classifyMismatch(5, null, 90)).toBeNull();
    expect(classifyMismatch(5, 30, null)).toBeNull();
  });

  test("returns null when MTBF or interval is non-positive", () => {
    expect(classifyMismatch(5, 0, 90)).toBeNull();
    expect(classifyMismatch(5, 30, 0)).toBeNull();
    expect(classifyMismatch(5, -1, 90)).toBeNull();
  });

  test("flags advisory when MTBF * 1.5 < interval but MTBF * 2 ≥ interval", () => {
    // MTBF=50, interval=90 → 50*1.5=75 < 90 (advisory), 50*2=100 ≥ 90
    expect(classifyMismatch(5, 50, 90)).toBe("advisory");
  });

  test("flags warning when MTBF * 2 < interval", () => {
    // MTBF=30, interval=90 → 30*2=60 < 90 (warning)
    expect(classifyMismatch(5, 30, 90)).toBe("warning");
  });

  test("returns null when reality matches or exceeds plan", () => {
    expect(classifyMismatch(5, 90, 90)).toBeNull();
    expect(classifyMismatch(5, 120, 90)).toBeNull();
    // boundary: MTBF * 1.5 ≥ interval → not flagged
    expect(classifyMismatch(5, 60, 90)).toBeNull();
  });
});

describe("formatPmMismatchLine", () => {
  const baseMismatch: PmMismatch = {
    equipmentId: "VFD-07",
    equipmentName: "PowerFlex 525",
    faultCode: "F004",
    occurrences: 5,
    mtbfDays: 30,
    pmTask: "bearing inspection",
    pmIntervalDays: 90,
    severity: "warning",
  };

  test("renders WARNING line with all key fields", () => {
    const line = formatPmMismatchLine(baseMismatch);
    expect(line).toContain("WARNING");
    expect(line).toContain("F004");
    expect(line).toContain("VFD-07");
    expect(line).toContain("30d");
    expect(line).toContain("5 occurrences");
    expect(line).toContain("bearing inspection");
    expect(line).toContain("90d");
    expect(line).toContain("interval too long");
  });

  test("renders ADVISORY line for advisory severity", () => {
    const line = formatPmMismatchLine({ ...baseMismatch, severity: "advisory", mtbfDays: 50 });
    expect(line).toContain("ADVISORY");
    expect(line).not.toContain("WARNING");
  });
});

describe("formatMaintenanceContext — pmMismatches surface", () => {
  function makeMc(): MaintenanceContext {
    return {
      equipment: {
        id: "uuid-eq-1", tenantId: "t", entityType: "equipment", entityId: "VFD-07",
        name: "PowerFlex 525", properties: {}, unsPath: null, createdAt: new Date(), updatedAt: new Date(),
      },
      hierarchy: { plant: null, area: null, line: null },
      components: [],
      recentFaults: [],
      recentWorkOrders: [],
      knownParts: [],
      manuals: [],
      pmSchedule: [],
      similarEquipment: [],
      pmMismatches: [],
    };
  }

  test("includes a Plan vs actual line when a mismatch is present", () => {
    const mc = makeMc();
    mc.pmMismatches = [
      {
        equipmentId: "VFD-07",
        equipmentName: "PowerFlex 525",
        faultCode: "F004",
        occurrences: 4,
        mtbfDays: 30,
        pmTask: "bearing inspection",
        pmIntervalDays: 90,
        severity: "warning",
      },
    ];
    const out = formatMaintenanceContext(mc);
    expect(out).toContain("Plan vs actual");
    expect(out).toContain("WARNING");
    expect(out).toContain("F004");
    expect(out).toContain("bearing inspection");
  });

  test("omits the line when there are no mismatches", () => {
    const out = formatMaintenanceContext(makeMc());
    expect(out).not.toContain("Plan vs actual");
  });

  test("caps mismatch lines at 3 to keep prompts compact", () => {
    const mc = makeMc();
    mc.pmMismatches = Array.from({ length: 6 }, (_, i) => ({
      equipmentId: "VFD-07",
      equipmentName: "PowerFlex 525",
      faultCode: `F00${i}`,
      occurrences: 3,
      mtbfDays: 20,
      pmTask: "PM",
      pmIntervalDays: 90,
      severity: "warning" as const,
    }));
    const out = formatMaintenanceContext(mc);
    const lines = out.split("\n").filter((l) => l.includes("Plan vs actual"));
    expect(lines.length).toBe(3);
  });
});
