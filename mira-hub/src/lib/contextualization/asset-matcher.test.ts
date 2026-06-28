import { describe, expect, it } from "vitest";

import { classifyAsset, fromEquipmentRow, type EquipmentRow } from "./asset-matcher";

// A small fleet of existing assets to classify incoming contextualization identity against.
const AB_DRIVE: EquipmentRow = {
  id: "asset-ab-drive",
  manufacturer: "Allen-Bradley",
  model: "PowerFlex 525",
  serialNumber: "SN-123",
};

describe("classifyAsset — PRD §6 tests 4/5/6 (strong / none / probable)", () => {
  it("test 4: a strong (unique-id) match stages under the existing asset, still proposed", () => {
    // serial number is an instance-unique key; normalization absorbs case/punctuation/whitespace
    const m = classifyAsset(
      { serialNumber: " sn-123 ", manufacturer: "allen bradley" },
      [AB_DRIVE],
    );
    expect(m.strength).toBe("strong");
    expect(m.decision).toBe("existing_asset");
    expect(m.matchedAssetId).toBe("asset-ab-drive");
    expect(m.matchedFields).toContain("serialNumber");
    // NEVER auto-verify — even a strong match lands as proposed for admin approval
    expect(m.approvalState).toBe("proposed");
  });

  it("test 5: no overlap creates a draft asset proposal (no existing asset)", () => {
    const m = classifyAsset(
      { manufacturer: "Siemens", model: "S7-1200", serialNumber: "XYZ-999" },
      [AB_DRIVE],
    );
    expect(m.strength).toBe("none");
    expect(m.decision).toBe("draft_asset");
    expect(m.matchedAssetId).toBeNull();
    expect(m.approvalState).toBe("proposed");
  });

  it("test 6: a probable (model-level only) match requires human confirmation", () => {
    // manufacturer + model agree but there is NO instance-unique key → cannot auto-stage
    const m = classifyAsset({ manufacturer: "Allen-Bradley", model: "PowerFlex 525" }, [
      { id: "asset-2", manufacturer: "Allen-Bradley", model: "PowerFlex 525" },
    ]);
    expect(m.strength).toBe("probable");
    expect(m.decision).toBe("needs_confirmation");
    expect(m.matchedAssetId).toBe("asset-2");
    expect(m.approvalState).toBe("proposed");
  });

  it("a unique UNS path match is also strong", () => {
    const m = classifyAsset({ proposedUnsPath: "enterprise/garage/cv_101" }, [
      { id: "asset-uns", proposedUnsPath: "enterprise.garage.cv_101" },
    ]);
    expect(m.strength).toBe("strong");
    expect(m.decision).toBe("existing_asset");
    expect(m.matchedAssetId).toBe("asset-uns");
  });
});

describe("classifyAsset — adversarial: no false-merge, no missed-match", () => {
  it("FALSE-MERGE GUARD: same mfr+model but a CONFLICTING serial is never strong", () => {
    // identical drive model, different physical unit → must NOT auto-stage under the existing asset
    const m = classifyAsset(
      { manufacturer: "Allen-Bradley", model: "PowerFlex 525", serialNumber: "SN-BBB" },
      [AB_DRIVE], // serial SN-123
    );
    expect(m.strength).not.toBe("strong");
    expect(m.decision).not.toBe("existing_asset");
    expect(m.strength).toBe("none"); // a conflicting instance-id means a different asset
    expect(m.conflictFields).toContain("serialNumber");
  });

  it("AMBIGUITY GUARD: two equally-strong candidates downgrade to needs_confirmation", () => {
    // duplicate serials in the asset registry → identity is ambiguous, do not pick one blindly
    const m = classifyAsset({ serialNumber: "DUP" }, [
      { id: "asset-a", serialNumber: "DUP" },
      { id: "asset-b", serialNumber: "DUP" },
    ]);
    expect(m.decision).toBe("needs_confirmation");
    expect(m.decision).not.toBe("existing_asset");
    expect(m.strength).toBe("probable");
  });

  it("MISSED-MATCH GUARD: normalization catches formatting differences (mfr+model)", () => {
    const m = classifyAsset(
      { manufacturer: "allen  bradley", model: "2080 lc50 24qwb" },
      [{ id: "asset-4", manufacturer: "Allen-Bradley", model: "2080-LC50-24QWB" }],
    );
    expect(m.strength).toBe("probable");
    expect(m.matchedAssetId).toBe("asset-4");
  });

  it("FALSE-MERGE GUARD: a placeholder serial (N/A) is not a strong identity match", () => {
    // CMMS registries are full of "N/A"/"0"/"UNKNOWN" serials — two different assets sharing a
    // placeholder must NOT auto-merge. The placeholder carries no identity, so fall back to model-level.
    const m = classifyAsset(
      { manufacturer: "Allen-Bradley", model: "PowerFlex 525", serialNumber: "N/A" },
      [{ id: "ph-1", manufacturer: "Allen-Bradley", model: "PowerFlex 525", serialNumber: "N/A" }],
    );
    expect(m.strength).not.toBe("strong");
    expect(m.decision).not.toBe("existing_asset");
    expect(m.strength).toBe("probable"); // mfr+model still corroborate → confirm, don't merge
  });

  it("FALSE-MERGE GUARD: a too-short unique id is not strong on its own", () => {
    const m = classifyAsset({ serialNumber: "7" }, [{ id: "short-1", serialNumber: "7" }]);
    expect(m.strength).not.toBe("strong");
    expect(m.decision).not.toBe("existing_asset");
  });

  it("a controller IP alone is only probable; corroborated by PLC program it is strong", () => {
    const ipOnly = classifyAsset({ controllerIp: "192.168.1.50" }, [
      { id: "ctrl-1", controllerIp: "192.168.1.50" },
    ]);
    expect(ipOnly.strength).toBe("probable");

    const corroborated = classifyAsset(
      { controllerIp: "192.168.1.50", plcProgramName: "Conv_Simple" },
      [{ id: "ctrl-1", controllerIp: "192.168.1.50", plcProgramName: "Conv_Simple" }],
    );
    expect(corroborated.strength).toBe("strong");
  });
});

describe("fromEquipmentRow — maps a cmms_equipment row to the matcher shape", () => {
  it("maps the real snake_case columns", () => {
    const row = fromEquipmentRow({
      id: "eq-1",
      equipment_number: "CV-101",
      manufacturer: "Allen-Bradley",
      model_number: "2080-LC50-24QWB",
      serial_number: "SN-123",
      uns_path: "enterprise.garage.cv_101",
    });
    expect(row).toEqual({
      id: "eq-1",
      assetNumber: "CV-101",
      manufacturer: "Allen-Bradley",
      model: "2080-LC50-24QWB",
      serialNumber: "SN-123",
      proposedUnsPath: "enterprise.garage.cv_101",
    });
  });
});
