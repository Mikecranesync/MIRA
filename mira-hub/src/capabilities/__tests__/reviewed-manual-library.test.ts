import { describe, expect, it } from "vitest";
import { reviewedManualFor } from "../reviewed-manual-library";

describe("reviewed manual library", () => {
  it.each([
    ["Automation Direct", "GS11N-20P2", 26],
    ["Siemens", "6AV2124-0GC01-0AX0", 3],
    ["Schneider", "CA3KN22BD", 1],
    ["ABB", "ACS355", 1],
  ])("resolves exact %s %s coverage", (manufacturer, model, page) => {
    const document = reviewedManualFor({ manufacturer, model });
    expect(document).toMatchObject({ page, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it.each([
    ["AutomationDirect", "GS11N"],
    ["AutomationDirect", "GS11N-20P2-EX"],
    ["AutomationDirect", "GS11N-20P25"],
    ["Siemens", "6AV2124-0GC01-0AX1"],
    ["Siemens", "GS11N-20P2"],
  ])("does not borrow applicability for %s %s", (manufacturer, model) => {
    expect(reviewedManualFor({ manufacturer, model })).toBeNull();
  });

  it("checks the model and catalog together, allowing only a reviewed family", () => {
    const identity = { manufacturer: "AutomationDirect", catalogNumber: "GS11N-20P2" };
    expect(reviewedManualFor({ ...identity, model: "GS10" })).toMatchObject({ page: 26 });
    expect(reviewedManualFor({ ...identity, model: "GS21N-20P2" })).toBeNull();
  });
});
