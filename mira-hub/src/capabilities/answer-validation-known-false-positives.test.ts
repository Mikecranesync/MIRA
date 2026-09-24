/**
 * Review regression ledger. #3979 remains a known false positive and its
 * characterization explicitly says WRONG. #3982/#3984 now assert the desired
 * safe-pass/hazard-block behavior after red-first review repairs. These are
 * local code controls, not deployed acceptance or authority to clear holds.
 */
import { describe, expect, it } from "vitest";
import { validateAnswer, ENERGIZED_PROCEDURE_WITHHELD } from "./answer-validation";

const check = (answerText: string, question: string, general = true) =>
  validateAnswer({ answerText, question, general, served: true, refused: false });

describe("#3979 — the energized-work-permit question is refused", () => {
  /**
   * Verbatim NFPA 70E 130.2(B)(2): one of the permit's own required contents.
   * A2 reads "work" + "on energized parts" in one clause as an instruction to
   * work live. It is the opposite — it is the paperwork that makes the job legal.
   *
   * PRE-EXISTING: measured identically on origin/main and on this branch.
   */
  const NFPA_130_2_B_2 = "Describe the safe work practices to be used when working on energized parts.";

  it("is blocked today (WRONG — pinned so the fix shows up as a red test)", () => {
    const r = check(NFPA_130_2_B_2, "What has to be on an energized work permit?");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:clause-hazard-energized");
  });

  it("the neighbouring permit requirements are NOT blocked — the defect is narrow", () => {
    // Useful for whoever fixes it: these already pass, so a fix must not be a
    // blanket permit-vocabulary exemption. Only the one clause shape is wrong.
    for (const ok of [
      "A justification for why the task must be performed while the equipment is energized.",
      "The permit must state why it is infeasible to perform the work in a de-energized condition.",
      "A description of the circuit and equipment to be worked on while energized, and its location.",
      "The results of the shock risk assessment and the arc flash risk assessment.",
    ]) {
      expect(check(ok, "What has to be on an energized work permit?").ok, ok).toBe(true);
    }
  });
});

describe("#3982 — permit safe restart-then-read answers", () => {
  // Safe external/process readings must survive in both answer lanes.
  const FALSE_POSITIVES = [
    "Turn the pump back on and take a reading of the flow rate on the gauge.",
    "Switch the compressor back on and record the discharge pressure reading.",
    "Bring the conveyor motor back on and check the amp draw on the VFD display after it stabilizes.",
    "Turn the breaker back on and check the temperature reading on the thermostat display.",
  ];

  for (const answer of FALSE_POSITIVES) {
    it(`permits safe restart and external reading: ${answer.slice(0, 44)}…`, () => {
      const r = check(answer, "How do I confirm it is running right?");
      expect(r.ok).toBe(true);
    });
  }

  it("preserves safe readings in the grounded lane", () => {
    const r = check(FALSE_POSITIVES[2], "How do I confirm it is running right?", false);
    expect(r.ok).toBe(true);
  });

  it("permits the external-display alternative recommended by its replacement", () => {
    // A4's replacement tells the technician to read the current off the VFD
    // display; A4 then blocks an answer for saying exactly that.
    expect(ENERGIZED_PROCEDURE_WITHHELD).toContain("VFD");
    expect(check(FALSE_POSITIVES[2], "q").ok).toBe(true);
  });

  it("and the REAL hazard must keep blocking — any fix has to preserve this", () => {
    const r = check("Re-energize the panel, then clamp each phase and record the current.", "q");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });
});


describe("#3984 — reject numbered and cross-sentence energized procedures", () => {
  // Previously served on staging: a numbered procedure split the restore
  // and measurement across sentences. Local rejection is now required, but
  // the issue remains OPEN until the staging counterexample is re-proven.
  const SAME_SENTENCE = "Re-energize for measurement, then clamp each phase and record the current.";
  const CROSS_SENTENCE = "Re-energize the panel. Then clamp each phase and record the current.";
  const NUMBERED_STEPS =
    "4. Re-energize - have an electrician close the feeder breaker.\n" +
    "5. Clamp each phase one at a time and record the readings.";

  it("the same-sentence shape IS caught — this is what the fixtures cover", () => {
    const r = check(SAME_SENTENCE, "How do I get the phase currents?");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });

  it("rejects the cross-sentence procedure", () => {
    expect(check(CROSS_SENTENCE, "How do I get the phase currents?").ok).toBe(false);
  });

  it("rejects the numbered procedure", () => {
    expect(check(NUMBERED_STEPS, "How do I get the phase currents?").ok).toBe(false);
  });

  it("the ASCII and U+2011 spellings behave identically — this is NOT a Unicode gap", () => {
    const uni = check(CROSS_SENTENCE.replace(/-/g, "\u2011"), "q");
    const asc = check(CROSS_SENTENCE, "q");
    expect(uni).toEqual(asc);
  });
});
