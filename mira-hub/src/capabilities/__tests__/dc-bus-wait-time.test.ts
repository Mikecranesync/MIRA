// Owner decision 4 (#4372, 2026-10-29): block equipment-specific DC-bus
// discharge wait-time numbers unless an applicable source supports them.
//
// "Supports" is decided deterministically: every duration the answer gives
// for the discharge wait must appear, as the same length of time, in a passage
// retrieved for this turn (or the photo observation) that is itself about
// stored electrical energy. A number the technician typed is not a source.
// Unlike the exact-rating rule, hedging does not exempt: "typically 5 minutes"
// is the dangerous case, because the wrong drive's number is the hazard.

import { describe, it, expect } from "vitest";
import { unsupportedDischargeWait, validateAnswer, DISCHARGE_WAIT_FALLBACK } from "@/capabilities/answer-validation";

const DC_Q = "how long do I wait for the dc bus capacitors to discharge after power off";
const LABEL =
  "WARNING: Risk of electric shock. Wait 15 minutes after removing power for the DC bus capacitors to discharge before servicing.";

describe("unsupportedDischargeWait — blocks a wait time no source states", () => {
  const blocked: Array<[string, string]> = [
    ["plain", "Wait 5 minutes after removing power before touching the DC bus."],
    ["number word + parenthetical", "Wait at least five (5) minutes for the capacitors to discharge."],
    ["hyphenated", "Allow a 5-minute discharge time for the bus capacitors."],
    ["abbreviation with dot", "Wait 5 min. for the DC bus to discharge, then measure."],
    ["run-together abbreviation", "Give the DC link 5mins to bleed down."],
    ["seconds", "Wait 300 s for the bus capacitors to discharge."],
    ["compound number word", "Wait forty-five seconds for the capacitors to discharge."],
    ["hedged is still blocked", "Typically you wait about 5 minutes for the DC bus to discharge."],
    ["unicode hyphen", "Allow a 5‑minute discharge time for the bus capacitors."],
  ];
  for (const [name, answer] of blocked) {
    it(`blocks: ${name}`, () => {
      expect(unsupportedDischargeWait(answer, DC_Q, [])).not.toBeNull();
    });
  }

  it("blocks when the stored-energy noun is in the previous sentence", () => {
    const a = "Remove power from the drive and lock it out. Wait 5 minutes before opening the cover.";
    expect(unsupportedDischargeWait(a, "drive cover removal", [])).toBeNull(); // control: no stored-energy context anywhere
    expect(unsupportedDischargeWait("The DC bus stays charged. Wait 5 minutes before opening the cover.", "drive cover removal", [])).not.toBeNull();
  });

  it("blocks when only the question carries the stored-energy context", () => {
    expect(unsupportedDischargeWait("Wait 5 minutes before you open the cover.", DC_Q, [])).not.toBeNull();
  });

  it("blocks a range unless every endpoint is supported", () => {
    const a = "Wait 3 to 5 minutes for the capacitors to bleed down.";
    const src = ["Wait 5 minutes for the DC bus capacitors to discharge."];
    expect(unsupportedDischargeWait(a, DC_Q, src)).not.toBeNull();
    expect(unsupportedDischargeWait(a, DC_Q, [...src, "Small frames: capacitors discharge within 3 minutes."])).toBeNull();
    // The upper endpoint alone unsupported must also block.
    expect(unsupportedDischargeWait(a, DC_Q, ["Small frames: capacitors discharge within 3 minutes."])).not.toBeNull();
  });

  it("a number only in the technician's question is not a source", () => {
    const q = "the label says wait 5 minutes for the dc bus, is that enough";
    expect(unsupportedDischargeWait("Yes, wait 5 minutes for the DC bus to discharge.", q, [])).not.toBeNull();
  });

  it("a duration in a source passage about something else does not support it (fan control)", () => {
    const src = ["Fan replacement takes about 5 minutes."];
    expect(unsupportedDischargeWait("Wait 5 minutes for the bus capacitors to discharge.", DC_Q, src)).not.toBeNull();
  });
});

describe("unsupportedDischargeWait — passes a wait time an applicable source states", () => {
  it("passes the label's own figure", () => {
    const a = "The manual says to wait 15 minutes for the DC bus capacitors to discharge [1], then measure DC+ to DC-.";
    expect(unsupportedDischargeWait(a, DC_Q, [LABEL])).toBeNull();
  });

  it("matches across units and number words", () => {
    expect(unsupportedDischargeWait("Wait 900 seconds for the DC bus to discharge.", DC_Q, [LABEL])).toBeNull();
    expect(unsupportedDischargeWait("Wait fifteen minutes for the DC bus to discharge.", DC_Q, [LABEL])).toBeNull();
  });

  it("a photographed warning label (photo observation text) is a source", () => {
    const look = "Nameplate photo: label reads 'Hazardous voltage. Wait 5 min after disconnecting power.'";
    expect(unsupportedDischargeWait("Wait 5 minutes for the DC bus to discharge.", DC_Q, [look])).toBeNull();
  });

  it("a supported figure does not launder an unsupported one", () => {
    const a = "Wait 15 minutes for the DC bus capacitors to discharge. On the larger frame, wait 20 minutes.";
    expect(unsupportedDischargeWait(a, DC_Q, [LABEL])).not.toBeNull();
  });
});

describe("unsupportedDischargeWait — ordinary answers are untouched", () => {
  const ok: Array<[string, string, string]> = [
    ["charging, not waiting", "The DC bus charges within 2 seconds of power-up.", "drive slow to start"],
    ["boot wait, no stored energy", "Wait 10 seconds for the drive to finish booting, then reset the fault.", "how to reset F004"],
    ["no number", "Wait the time printed on the drive's warning label, then measure the DC bus and confirm 0 V.", DC_Q],
    ["years are not a wait", "Bus capacitors age; plan to replace them every 5 years.", "capacitor life"],
    ["accel time setting", "Set the accel time to 5 seconds.", "drive trips on accel"],
  ];
  for (const [name, answer, q] of ok) {
    it(`passes: ${name}`, () => {
      expect(unsupportedDischargeWait(answer, q, [])).toBeNull();
    });
  }
});

describe("validateAnswer — decision 4 runs in both lanes, sources or not", () => {
  const answer = "Turn off and lock out the drive. Wait 5 minutes for the DC bus capacitors to discharge, then measure.";
  const base = { answerText: answer, question: DC_Q, served: true, refused: false } as const;

  for (const general of [true, false]) {
    it(`${general ? "general" : "grounded"} lane, sources that do not state it → replaced`, () => {
      const v = validateAnswer({ ...base, general, evidenceSufficient: true, sourceTexts: ["F004 is DC bus undervoltage."] });
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.kind).toBe("unsupported_specificity");
      expect(v.violation).toBe("unsupported-specificity:discharge-wait-time");
      expect(v.replacement).toBe(DISCHARGE_WAIT_FALLBACK);
    });
  }

  it("zero sources (the zero-source passthrough) → replaced", () => {
    const v = validateAnswer({ ...base, general: true, evidenceSufficient: false });
    expect(v.ok).toBe(false);
  });

  it("a source that states it → not this violation", () => {
    const v = validateAnswer({
      ...base,
      answerText: "Wait 15 minutes for the DC bus capacitors to discharge [1], then measure.",
      general: false,
      sourceTexts: [LABEL],
    });
    if (!v.ok) expect(v.violation).not.toBe("unsupported-specificity:discharge-wait-time");
  });

  it("the replacement carries no duration and passes the validator itself", () => {
    expect(DISCHARGE_WAIT_FALLBACK).not.toMatch(/\d/);
    expect(unsupportedDischargeWait(DISCHARGE_WAIT_FALLBACK, DC_Q, [])).toBeNull();
    expect(validateAnswer({ ...base, answerText: DISCHARGE_WAIT_FALLBACK, general: true }).ok).toBe(true);
  });
});
