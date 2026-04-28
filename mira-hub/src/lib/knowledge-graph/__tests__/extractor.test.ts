import { describe, test, expect } from "vitest";
import { extractEntitiesFromText } from "../extractor";

describe("extractEntitiesFromText — equipment tags", () => {
  test("extracts standard asset tags", () => {
    const { equipment } = extractEntitiesFromText(
      "The VFD-07 is tripping. Also check POW-755 and PUMP-99.",
    );
    expect(equipment).toContain("VFD-07");
    expect(equipment).toContain("POW-755");
    expect(equipment).toContain("PUMP-99");
  });

  test("extracts tags with alpha suffix", () => {
    const { equipment } = extractEntitiesFromText("Asset POW-755-A12 was inspected.");
    expect(equipment).toContain("POW-755-A12");
  });

  test("does not extract lowercase-only words", () => {
    const { equipment } = extractEntitiesFromText("check the pump again");
    expect(equipment).toHaveLength(0);
  });

  test("handles multiple tags in one sentence", () => {
    const { equipment } = extractEntitiesFromText("CNC-3 and HVA-12 both need lubrication.");
    expect(equipment).toContain("CNC-3");
    expect(equipment).toContain("HVA-12");
  });
});

describe("extractEntitiesFromText — fault codes", () => {
  test("extracts F-prefix codes", () => {
    const { faultCodes } = extractEntitiesFromText("Fault F005 and F30001 are active.");
    expect(faultCodes).toContain("F005");
    expect(faultCodes).toContain("F30001");
  });

  test("extracts 4-digit numeric codes", () => {
    const { faultCodes } = extractEntitiesFromText("Error code 2310 appeared on startup.");
    expect(faultCodes).toContain("2310");
  });

  test("extracts known short alpha codes", () => {
    const { faultCodes } = extractEntitiesFromText("The drive shows OC and UV faults.");
    expect(faultCodes).toContain("OC");
    expect(faultCodes).toContain("UV");
  });

  test("extracts ERR-prefixed codes", () => {
    const { faultCodes } = extractEntitiesFromText("ERR-105 logged at 08:42.");
    expect(faultCodes).toContain("ERR-105");
  });
});

describe("extractEntitiesFromText — part numbers", () => {
  test("extracts multi-segment part numbers", () => {
    const { parts } = extractEntitiesFromText(
      "Replace with IR-39868252 or DR-5V660-B200.",
    );
    expect(parts).toContain("IR-39868252");
    expect(parts).toContain("DR-5V660-B200");
  });

  test("does not extract short two-segment tags as parts", () => {
    // VFD-07 has only one suffix segment, too short to be a part number
    const { parts } = extractEntitiesFromText("VFD-07 is down.");
    expect(parts).not.toContain("VFD-07");
  });
});

describe("extractEntitiesFromText — action verbs", () => {
  test("extracts maintenance action verbs", () => {
    const { actions } = extractEntitiesFromText(
      "Tech replaced the bearing and calibrated the sensor.",
    );
    expect(actions).toContain("replaced");
    expect(actions).toContain("calibrated");
  });

  test("extracts inspect and clean", () => {
    const { actions } = extractEntitiesFromText("Cleaned the filter. Inspected the shaft.");
    expect(actions).toContain("cleaned");
    expect(actions).toContain("inspected");
  });

  test("does not match partial words", () => {
    const { actions } = extractEntitiesFromText("replacement ordered");
    // 'replacement' is not in ACTION_VERBS — only 'replace' and 'ordered'
    expect(actions).toContain("ordered");
    expect(actions).not.toContain("replacement");
  });
});

describe("extractEntitiesFromText — combined", () => {
  test("real conversation excerpt", () => {
    const text = `
      MIRA: The VFD-07 is showing fault code F005 (overcurrent).
      Recommended action: replaced the IR-39868252 air filter and calibrated
      the drive parameters. Check POW-755 if OC persists.
    `;
    const result = extractEntitiesFromText(text);
    expect(result.equipment).toContain("VFD-07");
    expect(result.equipment).toContain("POW-755");
    expect(result.faultCodes).toContain("F005");
    expect(result.faultCodes).toContain("OC");
    expect(result.parts).toContain("IR-39868252");
    expect(result.actions).toContain("replaced");
    expect(result.actions).toContain("calibrated");
  });

  test("empty text returns empty arrays", () => {
    const result = extractEntitiesFromText("");
    expect(result.equipment).toHaveLength(0);
    expect(result.faultCodes).toHaveLength(0);
    expect(result.parts).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });
});
