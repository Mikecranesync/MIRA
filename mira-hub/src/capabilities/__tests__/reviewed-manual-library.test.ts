import { describe, expect, it } from "vitest";
import { manualLookupPart, reviewedManualFor } from "../reviewed-manual-library";

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
    ["AutomationDirect", "GS10"],
    ["AutomationDirect", "GS11N-20P2-EX"],
    ["AutomationDirect", "GS11N-20P25"],
    ["Siemens", "6AV2124-0GC01-0AX1"],
    ["Siemens", "TP700 Comfort"],
    ["Siemens", "GS11N-20P2"],
    ["Schneider", "CA3K"],
  ])("does not borrow applicability for %s %s", (manufacturer, model) => {
    expect(reviewedManualFor({ manufacturer, model })).toBeNull();
  });

  it("checks the model and catalog together, allowing only a reviewed family", () => {
    const identity = { manufacturer: "AutomationDirect", catalogNumber: "GS11N-20P2" };
    expect(reviewedManualFor({ ...identity, model: "GS10" })).toMatchObject({ page: 26 });
    expect(reviewedManualFor({ ...identity, model: "GS11N" })).toMatchObject({ page: 26 });
    expect(reviewedManualFor({ ...identity, model: "GS21" })).toBeNull();
    expect(reviewedManualFor({ ...identity, model: "GS21N-20P2" })).toBeNull();
  });

  it("uses the same exact order number from either input field", () => {
    const part = "ACS355-03U-06A7-2";
    expect(manualLookupPart({ model: part, catalogNumber: " " })).toBe(part);
    expect(manualLookupPart({ model: "ACS355", catalogNumber: " acs355‑03u‑06a7‑2 " })).toBe(part);
    expect(manualLookupPart({ model: "", catalogNumber: " " })).toBeNull();
    expect(manualLookupPart({ model: "ACS355", catalogNumber: `${part}+B063` })).toBe(`${part}+B063`);
  });

  it("matches a reviewed order number with the same canonical spelling from either field", () => {
    const manufacturer = "Siemens";
    const catalogNumber = "6AV2124‑0GC01‑0AX0";
    expect(reviewedManualFor({ manufacturer, model: catalogNumber })?.page).toBe(3);
    expect(reviewedManualFor({ manufacturer, model: "TP700 Comfort", catalogNumber })?.page).toBe(3);
    expect(reviewedManualFor({ manufacturer, model: "TP900 Comfort", catalogNumber })).toBeNull();
  });

  it.each([
    ["Siemens", "6AV2124-0GC01-0AX0", "TP700 Comfort", "TP900 Comfort"],
    ["Schneider", "CA3KN22BD", "CA3K", "LC1D"],
  ])("checks the published %s family against order number %s", (manufacturer, catalogNumber, model, other) => {
    expect(reviewedManualFor({ manufacturer, model, catalogNumber })).not.toBeNull();
    expect(reviewedManualFor({ manufacturer, model: other, catalogNumber })).toBeNull();
  });

  it("uses the fixed Schneider product drawing for the exact relay", () => {
    const document = reviewedManualFor({ manufacturer: "Schneider Electric", model: "CA3KN22BD" });
    expect(document).toMatchObject({
      title: "TeSys K CA3KN22BD Product Drawing, English US",
      filename: "CA3KN22BD_2DSalesDrawing.pdf",
      page: 1,
    });
    expect(new URL(document!.url).searchParams.get("p_Doc_Ref")).toBe("CA3KN22BD_2DSalesDrawing");
  });
});
