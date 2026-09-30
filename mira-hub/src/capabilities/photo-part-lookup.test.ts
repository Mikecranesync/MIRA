import { describe, expect, it } from "vitest";
import { asksPartCompatibility, explicitManualLookupRequest, unambiguousPartNumber } from "./photo-part-lookup";

describe("photo part lookup", () => {
  it("uses one label-shaped code as a lookup candidate without asserting what it is", () => {
    expect(unambiguousPartNumber("Label reads Ni8U-S12-AP6; wiring: 1BN+ 3BU- 4BK")).toBe("Ni8U-S12-AP6");
  });

  it("refuses to choose when multiple label codes are present", () => {
    expect(unambiguousPartNumber("P/N Ni8U-S12-AP6; alternate Ni8U-S12-AP8")).toBeNull();
  });

  it("accepts a contiguous code only when the label marks it as a part/catalog number", () => {
    expect(unambiguousPartNumber("P/N 6AV2124-0GC01-0AX0; Serial P96166484")).toBe("6AV2124-0GC01-0AX0");
    expect(unambiguousPartNumber("P/N 6AV21240GC010AX0")).toBe("6AV21240GC010AX0");
    expect(unambiguousPartNumber("Label P96166484")).toBeNull();
  });

  it("does not treat short wire markings or retail barcodes as a part number", () => {
    expect(unambiguousPartNumber("1BN+ 3BU- 4BK X0026E67QS")).toBeNull();
    expect(unambiguousPartNumber("1P 230VAC, 50/60Hz")).toBeNull();
  });

  it("never selects an explicitly marked serial number", () => {
    expect(unambiguousPartNumber("P/N Ni8U-S12-AP6; Serial: AB-1234567")).toBe("Ni8U-S12-AP6");
  });

  it.each(["Look up the PDF manual", "Can you find the datasheet?"]) (
    "recognizes an explicit manual lookup: %s",
    (q) => expect(explicitManualLookupRequest(q)).toBe(true),
  );

  it("does not turn a generic help question into a web search", () => {
    expect(explicitManualLookupRequest("What does this part do?")).toBe(false);
  });

  it("recognizes compatibility questions without deciding compatibility", () => {
    expect(asksPartCompatibility("Is M12 a substitute for S12?")).toBe(true);
    expect(asksPartCompatibility("Can I use my M12 instead of this S12?")).toBe(true);
    expect(asksPartCompatibility("What does S12 mean?")).toBe(false);
  });
});
