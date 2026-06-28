import { describe, expect, it } from "vitest";
import { deriveStatus, assetMatchesStatusFilter, type AssetStatus } from "./asset-status";

// #1985: the status filter must match the SAME derived status the badge shows.
// The old "Active" chip filtered the unrelated `criticality` field, so it
// returned 0 even when operational assets existed.

// Minimal Asset shape for deriveStatus — only the fields it reads matter.
function asset(p: Partial<Parameters<typeof deriveStatus>[0]>) {
  return {
    downtimeHours: 0,
    lastFault: null,
    criticality: "medium",
    workOrderCount: 1,
    lastWorkOrder: "WO-1",
    ...p,
  } as Parameters<typeof deriveStatus>[0];
}

describe("deriveStatus", () => {
  const cases: Array<[string, Parameters<typeof asset>[0], AssetStatus]> = [
    ["downtime + fault → warning", { downtimeHours: 3, lastFault: "F12" }, "warning"],
    ["critical criticality + fault → critical", { criticality: "critical", lastFault: "F12" }, "critical"],
    ["no work orders ever → idle", { workOrderCount: 0, lastWorkOrder: null }, "idle"],
    ["otherwise → operational", {}, "operational"],
  ];
  for (const [name, patch, expected] of cases) {
    it(name, () => expect(deriveStatus(asset(patch))).toBe(expected));
  }
});

describe("assetMatchesStatusFilter", () => {
  it("'all' matches every asset", () => {
    expect(assetMatchesStatusFilter(asset({}), "all")).toBe(true);
    expect(assetMatchesStatusFilter(asset({ workOrderCount: 0, lastWorkOrder: null }), "all")).toBe(true);
  });

  it("matches by the derived status, not the raw criticality field (the #1985 bug)", () => {
    // Operational asset whose criticality is NOT 'critical' — the old "Active"
    // (key=critical) chip filtered `criticality==='critical'` and dropped it.
    const op = asset({ criticality: "low" });
    expect(deriveStatus(op)).toBe("operational");
    expect(assetMatchesStatusFilter(op, "operational")).toBe(true);
    expect(assetMatchesStatusFilter(op, "critical")).toBe(false);
  });

  it("a derived-critical asset matches the 'critical' filter", () => {
    const crit = asset({ criticality: "critical", lastFault: "F12" });
    expect(deriveStatus(crit)).toBe("critical");
    expect(assetMatchesStatusFilter(crit, "critical")).toBe(true);
    expect(assetMatchesStatusFilter(crit, "operational")).toBe(false);
  });

  it("idle + warning filters key off derived status", () => {
    expect(assetMatchesStatusFilter(asset({ workOrderCount: 0, lastWorkOrder: null }), "idle")).toBe(true);
    expect(assetMatchesStatusFilter(asset({ downtimeHours: 2, lastFault: "F1" }), "warning")).toBe(true);
  });
});
