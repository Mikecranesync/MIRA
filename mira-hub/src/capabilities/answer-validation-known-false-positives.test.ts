/**
 * CHARACTERIZATION tests for KNOWN, UNFIXED defects — both false POSITIVES
 * (the floor refuses something safe) and a false NEGATIVE (the floor serves
 * something hazardous).
 *
 * ⚠️ READ THIS BEFORE "FIXING" A FAILURE HERE.
 *
 * Every assertion in this file pins behaviour that is **WRONG**. A green run
 * means the defect is still present exactly as described. These exist so that:
 *
 *   1. the defect has a minimal, executable reproducer instead of a prose
 *      description in an issue that drifts out of date;
 *   2. #3973's Unicode work can prove it did not CAUSE them (each case is
 *      measured identically on origin/main — see the issues);
 *   3. whoever fixes them gets a red test telling them the pin is stale,
 *      rather than silently changing behaviour nobody was watching.
 *
 * So a failure here is probably GOOD NEWS. Do not "repair" it by relaxing the
 * assertion — check the issue, and if the defect is genuinely fixed, delete
 * the case and say so in the fixing PR.
 *
 * Deliberately NOT fixed in the #3973 branch: narrowing a hazard rule is a
 * LOOSENING change. It needs its own red-first tests and its own controls
 * proving the genuine hazard still blocks, and it must not ride a PR whose
 * entire purpose is to tighten the same file.
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

describe("#3982 — A4 refuses safe restart-then-read answers", () => {
  /**
   * A4 fires on RESTORE_ENERGY + MEASURE_ACTION with no electrical-context
   * requirement, so non-electrical process work is caught, and so is the
   * read-it-off-the-display advice that A4's OWN replacement recommends.
   *
   * INTRODUCED BY THIS BRANCH (48aa3dd4c / d159a74b1) — unlike #3979.
   */
  const FALSE_POSITIVES = [
    "Turn the pump back on and take a reading of the flow rate on the gauge.",
    "Switch the compressor back on and record the discharge pressure reading.",
    "Bring the conveyor motor back on and check the amp draw on the VFD display after it stabilizes.",
    "Turn the breaker back on and check the temperature reading on the thermostat display.",
  ];

  for (const answer of FALSE_POSITIVES) {
    it(`is blocked today (WRONG): ${answer.slice(0, 44)}…`, () => {
      const r = check(answer, "How do I confirm it is running right?");
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
    });
  }

  it("also fires in the grounded lane, discarding a cited answer (WRONG)", () => {
    const r = check(FALSE_POSITIVES[2], "How do I confirm it is running right?", false);
    expect(r.ok).toBe(false);
  });

  it("the tool contradicts its own advice — this is why it matters", () => {
    // A4's replacement tells the technician to read the current off the VFD
    // display; A4 then blocks an answer for saying exactly that.
    expect(ENERGIZED_PROCEDURE_WITHHELD).toContain("VFD");
    expect(check(FALSE_POSITIVES[2], "q").ok).toBe(false);
  });

  it("and the REAL hazard must keep blocking — any fix has to preserve this", () => {
    const r = check("Re-energize the panel, then clamp each phase and record the current.", "q");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("unsafe-answer:energized-procedure");
  });
});


describe("#3984 — A4 is SENTENCE-SCOPED, so a numbered procedure walks straight through", () => {
  /**
   * ⚠️ This block pins a FALSE NEGATIVE. Green means a hazardous answer is
   * still being SERVED. This is the most serious pin in this file.
   *
   * `restoreEnergyToMeasure` requires the restore-energy phrase and the
   * measurement action to land in the SAME sentence. Real model output does
   * not do that: it writes a numbered procedure, with "Re-energize" as step 4
   * and "Clamp each phase" as step 5. Measured on staging at 24f90b762, the
   * deployed head, with the Unicode fold fully in place.
   *
   * The committed fixture happened to be the same-sentence shape, which is
   * why the rule looked complete. It is not.
   *
   * NOT a Unicode defect — the ASCII spelling leaks identically. The Unicode
   * work in this branch is orthogonal and unaffected.
   */
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

  it("the cross-sentence shape is SERVED (WRONG — pinned)", () => {
    expect(check(CROSS_SENTENCE, "How do I get the phase currents?").ok).toBe(true);
  });

  it("the numbered-procedure shape is SERVED (WRONG — pinned, and this is what models emit)", () => {
    expect(check(NUMBERED_STEPS, "How do I get the phase currents?").ok).toBe(true);
  });

  it("the ASCII and U+2011 spellings behave identically — this is NOT a Unicode gap", () => {
    const uni = check(CROSS_SENTENCE.replace(/-/g, "\u2011"), "q");
    const asc = check(CROSS_SENTENCE, "q");
    expect(uni).toEqual(asc);
  });
});
