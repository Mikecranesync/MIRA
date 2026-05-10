import { describe, it, expect } from "vitest";
import { inferEquipmentType } from "../equipment-type";

describe("inferEquipmentType", () => {
  it("trusts the equipment_type column when populated", () => {
    expect(
      inferEquipmentType({ equipmentType: "VFD", manufacturer: "Anything" }),
    ).toBe("VFDs");
    expect(
      inferEquipmentType({ equipmentType: "PLC controller" }),
    ).toBe("PLCs");
    expect(
      inferEquipmentType({ equipmentType: "Touch Panel" }),
    ).toBe("HMIs");
  });

  it.each([
    ["PowerFlex 525", "Allen-Bradley", "VFDs"],
    ["SINAMICS G120", "Siemens", "VFDs"],
    ["GA500", "Yaskawa", "VFDs"],
    ["ACS580", "ABB", "VFDs"],
    ["ATV630", "Schneider", "VFDs"],
  ])("VFD model %s → VFDs", (model, mfr, expected) => {
    expect(inferEquipmentType({ modelNumber: model, manufacturer: mfr })).toBe(
      expected,
    );
  });

  it.each([
    ["CompactLogix 5380", "Allen-Bradley", "PLCs"],
    ["ControlLogix L73", "Allen-Bradley", "PLCs"],
    ["MicroLogix 1400", "Allen-Bradley", "PLCs"],
    ["Micro820", "Allen-Bradley", "PLCs"],
    ["S7-1200", "Siemens", "PLCs"],
    ["S7-1500", "Siemens", "PLCs"],
  ])("PLC model %s → PLCs", (model, mfr, expected) => {
    expect(inferEquipmentType({ modelNumber: model, manufacturer: mfr })).toBe(
      expected,
    );
  });

  it("falls back to manufacturer hint when no model match", () => {
    expect(
      inferEquipmentType({
        modelNumber: "Z-9999",
        manufacturer: "Allen-Bradley",
      }),
    ).toBe("PLCs");
    expect(
      inferEquipmentType({ modelNumber: null, manufacturer: "ABB" }),
    ).toBe("VFDs");
  });

  it("returns Other when nothing matches", () => {
    expect(
      inferEquipmentType({
        modelNumber: "completely unknown",
        manufacturer: "ObscureCo",
      }),
    ).toBe("Other");
  });

  it("uses title and source_url as additional hints", () => {
    expect(
      inferEquipmentType({
        title: "PowerFlex 750-Series User Manual",
        manufacturer: "Allen-Bradley",
      }),
    ).toBe("VFDs");
    expect(
      inferEquipmentType({
        sourceUrl: "https://example.com/manuals/SINAMICS-S120-list.pdf",
        manufacturer: "Siemens",
      }),
    ).toBe("VFDs");
  });
});
