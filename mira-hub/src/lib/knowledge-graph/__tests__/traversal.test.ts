import { describe, test, expect } from "vitest";
import { classifyKgIntent, formatMaintenanceContext } from "../context-builder";
import type { MaintenanceContext } from "../traversal";

// Pure functions only — no DB. Integration tests for the SQL traversals
// run separately against a Neon dev branch.

describe("classifyKgIntent", () => {
  test("flags causal phrasing", () => {
    expect(classifyKgIntent("Why did VFD-07 trip last night?")).toBe("causal");
    expect(classifyKgIntent("What caused the F004 fault?")).toBe("causal");
    expect(classifyKgIntent("Root cause of the bearing failure?")).toBe("causal");
  });

  test("flags impact phrasing", () => {
    expect(classifyKgIntent("If conveyor 3 goes down what else stops?")).toBe("impact");
    expect(classifyKgIntent("Show me downstream equipment for VFD-07")).toBe("impact");
    expect(classifyKgIntent("What lines are affected when M-1 fails?")).toBe("impact");
  });

  test("flags history phrasing", () => {
    expect(classifyKgIntent("Show me all faults in the last 90 days")).toBe("history");
    expect(classifyKgIntent("Failure history for PUMP-99")).toBe("history");
  });

  test("defaults when no signal", () => {
    expect(classifyKgIntent("Hello, can you help me?")).toBe("default");
    expect(classifyKgIntent("What is the model number of VFD-07?")).toBe("default");
  });
});

describe("formatMaintenanceContext", () => {
  function makeMc(overrides: Partial<MaintenanceContext> = {}): MaintenanceContext {
    const equipment = {
      id: "uuid-eq-1",
      tenantId: "tenant-1",
      entityType: "equipment",
      entityId: "VFD-07",
      name: "PowerFlex 525",
      properties: {
        manufacturer: "Allen-Bradley",
        model_number: "525",
        equipment_type: "VFD",
        criticality: "high",
      },
      unsPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return {
      equipment,
      hierarchy: { plant: null, area: null, line: null },
      components: [],
      recentFaults: [],
      recentWorkOrders: [],
      knownParts: [],
      manuals: [],
      pmSchedule: [],
      similarEquipment: [],
      pmMismatches: [],
      ...overrides,
    };
  }

  test("renders entity header + type", () => {
    const out = formatMaintenanceContext(makeMc());
    expect(out).toContain("[GRAPH CONTEXT for VFD-07]");
    expect(out).toContain("Allen-Bradley");
    expect(out).toContain("525");
    expect(out).toContain("VFD");
    expect(out).toContain("Criticality: high");
  });

  test("renders hierarchy chain when present", () => {
    const mc = makeMc({
      hierarchy: {
        plant: {
          id: "p1", tenantId: "t1", entityType: "plant", entityId: "STARDUST",
          name: "Stardust Racers", properties: {}, unsPath: null, createdAt: new Date(), updatedAt: new Date(),
        },
        area: {
          id: "a1", tenantId: "t1", entityType: "area", entityId: "ZONE_A",
          name: "Zone A", properties: {}, unsPath: null, createdAt: new Date(), updatedAt: new Date(),
        },
        line: {
          id: "l1", tenantId: "t1", entityType: "line", entityId: "LINE_3",
          name: "Line 3", properties: {}, unsPath: null, createdAt: new Date(), updatedAt: new Date(),
        },
      },
    });
    const out = formatMaintenanceContext(mc);
    expect(out).toContain("Plant STARDUST");
    expect(out).toContain("Area ZONE_A");
    expect(out).toContain("Line LINE_3");
    expect(out).toContain("→");
  });

  test("falls back to location property when no hierarchy", () => {
    const mc = makeMc();
    mc.equipment.properties = { ...mc.equipment.properties, location: "Building A" };
    const out = formatMaintenanceContext(mc);
    expect(out).toContain("Location: Building A");
  });

  test("renders fault counts with x notation when count > 1", () => {
    const mc = makeMc({
      recentFaults: [
        { code: "F004", count: 3, lastSeen: new Date("2026-04-22T00:00:00Z") },
        { code: "OC", count: 1, lastSeen: new Date("2026-04-10T00:00:00Z") },
      ],
    });
    const out = formatMaintenanceContext(mc);
    expect(out).toContain("F004 ×3");
    expect(out).toContain("OC");
    expect(out).toContain("2026-04-22");
  });

  test("renders pm schedule with interval + next due", () => {
    const mc = makeMc({
      pmSchedule: [
        {
          task: "bearing inspection",
          intervalDays: 90,
          lastRun: new Date("2026-02-15T00:00:00Z"),
          nextDue: new Date("2026-05-15T00:00:00Z"),
        },
      ],
    });
    const out = formatMaintenanceContext(mc);
    expect(out).toContain("bearing inspection");
    expect(out).toContain("90d");
    expect(out).toContain("2026-05-15");
  });

  test("omits sections that are empty", () => {
    const out = formatMaintenanceContext(makeMc());
    expect(out).not.toContain("Components:");
    expect(out).not.toContain("Recent faults:");
    expect(out).not.toContain("Parts on record:");
    expect(out).not.toContain("PM schedule:");
  });
});
