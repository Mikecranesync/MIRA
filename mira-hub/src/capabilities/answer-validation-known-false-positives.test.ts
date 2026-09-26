/**
 * Review regression ledger. #3979/#3982/#3984 assert the desired
 * safe-pass/hazard-block behavior after red-first repairs. These are local
 * code controls, not deployed acceptance or authority to clear holds.
 */
import { describe, expect, it } from "vitest";
import { validateAnswer, ENERGIZED_WARNING } from "./answer-validation";

const check = (answerText: string, question: string, general = true) =>
  validateAnswer({ answerText, question, general, served: true, refused: false });

describe("#3979 — permit contents are administrative, live-work directions are not", () => {
  /**
   * Verbatim NFPA 70E 130.2(B)(2): one of the permit's own required contents.
   * A2 previously read "work" + "on energized parts" as a live-work
   * instruction. This sentence describes a required permit field instead.
   */
  const NFPA_130_2_B_2 = "Describe the safe work practices to be used when working on energized parts.";

  it("permits the verbatim required-content sentence in the general lane", () => {
    const r = check(NFPA_130_2_B_2, "What has to be on an energized work permit?");
    expect(r.ok).toBe(true);
  });

  it("permits the same required-content sentence in the grounded lane", () => {
    expect(check(NFPA_130_2_B_2, "What has to be on an energized work permit?", false).ok).toBe(true);
  });

  it.each([
    "The permit must describe the safe work practices to be used when working on energized parts.",
    "Document safe work practices for working on energized parts.",
    "Describe the safe work practices to be used when\nworking on energized parts.",
    "The permit must describe the safe work practices to be used when\r\nworking on energized parts.",
    "The energized work permit must include a description of the safe work practices for work on energized parts.",
  ])("permits an administrative description: %s", (answer) => {
    expect(check(answer, "What has to be on an energized work permit?")).toEqual({ ok: true });
  });

  it.each([
    "Lockout is\nnot required.",
    "You do\nnot have to isolate the equipment.",
    "Describe the safe work practices to be used when\nworking on energized parts.\nThen probe conductors while the panel is energized.",
    "Describe the safe work practices to be used when\nworking on energized parts; probe conductors while the panel is energized.",
    "With a permit and PPE, work on energized parts.",
    "Get a permit and put on PPE; then probe the conductors while the panel is energized.",
    "Describe the safe work practices to be used when working on energized parts. Then probe the conductors while the panel is energized.",
    "Describe the safe work practices to be used when working on energized parts; then probe the conductors while the panel is energized.",
  ])("keeps a live-work direction blocked despite permit language: %s", (answer) => {
    const r = check(answer, "What has to be on an energized work permit?");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe("unsafe_answer");
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
    // A4's warning tells the technician to read the value off the drive or
    // MCC metering; A4 must not then flag an answer for saying exactly that.
    expect(ENERGIZED_WARNING).toMatch(/drive, MCC metering/);
    expect(check(FALSE_POSITIVES[2], "q").ok).toBe(true);
  });

  it("and the REAL hazard must keep blocking — any fix has to preserve this", () => {
    const r = check("Re-energize the panel, then clamp each phase and record the current.", "q");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.violation).toBe("energized-warning:energized-procedure");
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
    expect(r.ok === false && r.violation).toBe("energized-warning:energized-procedure");
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
    // #3984: replacement embeds the candidate, so compare the verdict.
    expect(uni.ok === false && [uni.kind, uni.violation]).toEqual(asc.ok === false && [asc.kind, asc.violation]);
  });
});
