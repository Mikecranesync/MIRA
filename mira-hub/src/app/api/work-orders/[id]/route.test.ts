import { describe, expect, it } from "vitest";
import { rowToWO } from "@/app/api/work-orders/[id]/route";

// Regression for #2375: a completed work order is PATCHed with a resolution and a
// close time, but the GET detail used to drop both — so the next technician saw a
// blank closure. rowToWO must surface resolution / fault_description / closed_at.
describe("rowToWO closure fields (#2375)", () => {
  it("surfaces resolution, fault_description, and closed_at when present", () => {
    const wo = rowToWO({
      id: "wo-1",
      title: "Pump down",
      status: "completed",
      resolution: "Replaced bearing; verified vibration in spec",
      fault_description: "Overcurrent trip at startup",
      closed_at: "2026-06-30T03:04:13.323Z",
    });

    expect(wo.resolution).toBe("Replaced bearing; verified vibration in spec");
    expect(wo.fault_description).toBe("Overcurrent trip at startup");
    expect(wo.closed_at).toBe("2026-06-30T03:04:13.323Z");
  });

  it("returns null (not undefined) for an open work order with no closure data", () => {
    const wo = rowToWO({ id: "wo-2", title: "Inspect", status: "open" });

    // The keys must exist and be null — a consumer reads them unconditionally.
    expect(wo.resolution).toBeNull();
    expect(wo.fault_description).toBeNull();
    expect(wo.closed_at).toBeNull();
    expect("resolution" in wo).toBe(true);
    expect("closed_at" in wo).toBe(true);
  });
});
