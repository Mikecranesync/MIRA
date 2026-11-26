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

// Codex round 1 on #4929 (F1, F2, F4).
describe("unsupportedDischargeWait — Codex round 1", () => {
  it("F1: a figure without a wait verb is still a claim", () => {
    expect(unsupportedDischargeWait("The DC bus capacitors can remain charged for 5 minutes.", DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("They retain voltage for about 5 minutes.", DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("Do not touch the bus terminals for 5 minutes.", DC_Q, [])).not.toBeNull();
  });

  it("F2: a duration next to a stored-energy sentence does not support a discharge wait", () => {
    const src = ["DC bus capacitors can retain hazardous voltage after shutdown. The cooling fan runs for 5 minutes after shutdown."];
    expect(unsupportedDischargeWait("Wait 5 minutes for the DC bus capacitors to discharge.", DC_Q, src)).not.toBeNull();
  });

  it("F4: power-up charging timing is not a discharge wait", () => {
    const q = "How long after power-up does the DC bus take to charge?";
    expect(unsupportedDischargeWait("Wait 10 seconds after power-up for the DC bus to charge.", q, [])).toBeNull();
    expect(unsupportedDischargeWait("The precharge relay closes about 2 seconds after the DC bus charges up.", q, [])).toBeNull();
  });

  it("unrelated timing in a DC-bus conversation is not a claim", () => {
    expect(unsupportedDischargeWait("Raise the decel time from 2 seconds to 5 seconds.", "DC bus overvoltage on decel", [])).toBeNull();
    expect(unsupportedDischargeWait("Set the accel time to 5 seconds.", DC_Q, [])).toBeNull();
  });
});

describe("unsupportedDischargeWait — support needs a stored-energy source sentence", () => {
  it("a neutral duration in a source does not support a discharge wait", () => {
    const src = ["Allow 5 minutes for the enclosure to cool down."];
    expect(unsupportedDischargeWait("Wait 5 minutes for the DC bus capacitors to discharge.", DC_Q, src)).not.toBeNull();
  });
});

// Codex round 2 on #4929 (F2): evaluate clauses, not whole sentences.
describe("unsupportedDischargeWait — Codex round 2", () => {
  it("F2: a fan clause in the same sentence does not exempt the discharge claim", () => {
    const a = "Wait 5 minutes for the DC bus capacitors to discharge; the cooling fan may continue running during this time.";
    expect(unsupportedDischargeWait(a, DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("Wait 5 minutes for the capacitors to discharge while the fan keeps running.", DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("Wait 5 minutes for the capacitors to discharge — the fan may still spin.", DC_Q, [])).not.toBeNull();
  });
  it("a range written with an en dash is still one claim with two endpoints", () => {
    const src = ["Wait 5 minutes for the DC bus capacitors to discharge."];
    expect(unsupportedDischargeWait("Wait 3–5 minutes for the capacitors to discharge.", DC_Q, src)).not.toBeNull();
  });
  it("a fan timing clause next to a discharge claim the source supports passes", () => {
    const a = "Wait 15 minutes for the DC bus capacitors to discharge; the cooling fan runs for 2 minutes after shutdown.";
    expect(unsupportedDischargeWait(a, DC_Q, [LABEL])).toBeNull();
  });
});

describe("unsupportedDischargeWait — a fan word inside the discharge clause", () => {
  it("does not make the clause unrelated timing", () => {
    expect(unsupportedDischargeWait("Wait 5 minutes for the fan-cooled bus capacitors to discharge.", DC_Q, [])).not.toBeNull();
  });
});

// Codex round 3 on #4929 (F1, F2).
describe("unsupportedDischargeWait — Codex round 3", () => {
  it("F1: natural-language durations are claims", () => {
    expect(unsupportedDischargeWait("Wait half an hour for the DC bus to discharge before touching it.", DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("Wait a quarter hour for the DC bus to discharge.", DC_Q, [])).not.toBeNull();
    expect(unsupportedDischargeWait("Give the capacitors a few minutes to discharge.", DC_Q, [])).not.toBeNull();
  });
  it("F1: compound hundreds are read whole, never as their suffix", () => {
    const a = "Wait one hundred twenty seconds for the DC bus capacitors to discharge.";
    expect(unsupportedDischargeWait(a, DC_Q, ["Wait 20 seconds for the DC bus capacitors to discharge."])).not.toBeNull();
    expect(unsupportedDischargeWait(a, DC_Q, ["Wait two minutes for the DC bus capacitors to discharge."])).toBeNull();
    expect(unsupportedDischargeWait(a, DC_Q, ["Wait 120 seconds for the DC bus capacitors to discharge."])).toBeNull();
  });
  it("F1: a supported natural-language figure passes", () => {
    expect(unsupportedDischargeWait("Wait half an hour for the DC bus to discharge.", DC_Q, ["Wait 30 minutes for the DC bus capacitors to discharge."])).toBeNull();
  });
  it("F2: a fan duration joined by a bare 'and' in the source is not support", () => {
    const src = ["DC bus capacitors discharge after shutdown and the cooling fan runs for 5 minutes."];
    expect(unsupportedDischargeWait("Wait 5 minutes for the DC bus capacitors to discharge.", DC_Q, src)).not.toBeNull();
    expect(unsupportedDischargeWait("Wait 5 minutes for the DC bus capacitors to discharge.", DC_Q, ["Wait 5 minutes for the DC bus capacitors to discharge."])).toBeNull();
  });
});

describe("unsupportedDischargeWait — conservative support (each rule on its own)", () => {
  const A = "Wait 5 minutes for the DC bus capacitors to discharge.";
  it("a bare 'and' separates propositions even with no fan/boot word", () => {
    expect(unsupportedDischargeWait(A, DC_Q, ["DC bus capacitors discharge within 3 minutes and the drive restarts in 5 minutes."])).not.toBeNull();
  });
  it("a single proposition that mentions fan timing supports nothing", () => {
    expect(unsupportedDischargeWait(A, DC_Q, ["The cooling fan for the DC bus runs 5 minutes after shutdown."])).not.toBeNull();
  });
});

// Codex round 4 on #4929 (F1, F2).
describe("unsupportedDischargeWait — Codex round 4", () => {
  const A = "Wait 5 minutes for the DC bus capacitors to discharge.";
  it("F1: a post-shutdown time about another subject (LED, motor, display) is not support", () => {
    for (const src of [
      "After shutdown, the status LED remains lit for 5 minutes. Verify the DC bus is at zero before touching terminals.",
      "After shutdown, let the motor cool for 5 minutes. Verify the DC bus is at zero before touching terminals.",
      "After power off the display stays on for 5 minutes. The DC bus must be verified at zero.",
    ]) expect(unsupportedDischargeWait(A, DC_Q, [src]), src).not.toBeNull();
  });
  it("F1 control: a proposition that ties the time to the DC bus is support", () => {
    expect(unsupportedDischargeWait(A, DC_Q, ["The DC bus discharges within 5 minutes after shutdown."])).toBeNull();
  });
  it("F2: stored-energy context carries through the paragraph past an intervening step", () => {
    const a = "The DC bus capacitors retain charge after shutdown. Lock out the disconnect. Wait 5 minutes before opening the cover.";
    expect(unsupportedDischargeWait(a, "How do I replace the drive?", [])).not.toBeNull();
  });
  it("F2 control: a later paragraph on another topic is not carried", () => {
    const a = "The DC bus capacitors stay charged, so use the drive label's wait time and measure to zero.\n\nAfter the swap, set the accel to ramp in 5 seconds and run the conveyor test.";
    expect(unsupportedDischargeWait(a, "How do I replace the drive?", [])).toBeNull();
  });
});
