import { describe, expect, it } from "vitest";
import { buildNodeUnsPath } from "./route";

describe("buildNodeUnsPath", () => {
  it("root node (no parent) is anchored under enterprise", () => {
    // Regression: before #1983-fix, root nodes got uns_path = slug (e.g. "plant_bostck"),
    // which the tree query's `<@ 'enterprise'` filter excluded — node never appeared after create.
    expect(buildNodeUnsPath(null, "plant_bostck")).toBe("enterprise.plant_bostck");
    expect(buildNodeUnsPath(null, "lake_wales")).toBe("enterprise.lake_wales");
  });

  it("child node extends parent path", () => {
    expect(buildNodeUnsPath("enterprise.lake_wales", "line_a")).toBe("enterprise.lake_wales.line_a");
    expect(buildNodeUnsPath("enterprise.lake_wales.line_a", "pump_01")).toBe(
      "enterprise.lake_wales.line_a.pump_01",
    );
  });
});
