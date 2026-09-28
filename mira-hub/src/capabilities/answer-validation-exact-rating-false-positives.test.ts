/**
 * The general-lane exact-rating rule replaced correct textbook answers with
 * "I can't verify that machine-specific detail" (2026-09-28 exam on staging
 * 76887423c: Q3 and Q6; a re-ask of Q3 recorded
 * `answer_gate.reason = unsupported-specificity:exact-rating`, trace
 * 8f88d2c3ff267b2382da35e4e4c53732).
 *
 * Two shapes are not rating claims about this machine:
 *   1. The technician's own numbers, restated from the question. The rule's
 *      header already says "the user's own numbers … are not rated-claims";
 *      the code never implemented it.
 *   2. An all-zero energy-isolation verification ("verified at 0 V"), which
 *      MIRA_CORE requires in the same sentence as any wiring step. Found by
 *      #3959 on staging (4 of 6 drafts replaced on the LOTO clause alone).
 *
 * Controls: a rating the question did NOT supply still fires, and so does a
 * range with a non-zero endpoint.
 */
import { describe, expect, it } from "vitest";

import { unsupportedExactRating, validateAnswer } from "./answer-validation";

const Q3 =
  "A 460V VFD is powering a pump motor. A technician measures 420V at the drive output terminals while the drive is commanded to run at 60 Hz. What is the FIRST parameter to verify?";
const Q6 =
  "A VFD mounted in a panel that reaches 45°C trips on overtemperature. The drive is rated for 40°C ambient. What should be checked first?";

function general(answerText: string, question: string) {
  return validateAnswer({
    answerText,
    question,
    general: true,
    served: true,
    refused: false,
    evidenceSufficient: false,
  });
}

describe("exact-rating: the technician's own numbers are not a rating claim", () => {
  it("Q3 restated: output voltage of 420 V on a 460 V drive", () => {
    const a =
      "The output voltage is 420 V while the drive is rated 460 V, so first verify the input voltage to the drive. A low DC bus limits the output the drive can produce.";
    expect(unsupportedExactRating(a, Q3)).toBeNull();
    expect(general(a, Q3).ok).toBe(true);
  });

  it("Q6 restated: the drive is rated for 40 °C", () => {
    const a =
      "The panel temperature is 45 °C and the drive is rated for 40 °C ambient, so check the enclosure cooling first: fans, filters and airflow.";
    expect(unsupportedExactRating(a, Q6)).toBeNull();
    expect(general(a, Q6).ok).toBe(true);
  });

  it("control: a rating the question never supplied still fires", () => {
    const a = "The maximum output current is 12.5 A for this drive.";
    expect(unsupportedExactRating(a, Q3)).toMatch(/12\.5\s*a/i);
    expect(general(a, Q3).ok).toBe(false);
  });

  it("control: one supplied number does not excuse an unsupplied one in the same claim", () => {
    const a = "The operating range is 420 to 528 V.";
    expect(unsupportedExactRating(a, Q3)).not.toBeNull();
  });

  it("control (#4093 Codex F1): a number the question gave for a DIFFERENT component still fires", () => {
    const q = "The relay contacts are rated 12 A. What is the motor current?";
    const a = "The motor rated current is 12 A.";
    expect(unsupportedExactRating(a, q)).not.toBeNull();
    expect(general(a, q).ok).toBe(false);
  });

  it("control: the same number with a different unit is not a restatement", () => {
    const q = "The supply is 24 V. What current should the coil draw?";
    expect(unsupportedExactRating("The coil current is 24 A.", q)).not.toBeNull();
  });

  it("control: with no question the rule behaves exactly as before", () => {
    expect(unsupportedExactRating("The output voltage is 420 V.")).not.toBeNull();
  });
});

describe("exact-rating: an all-zero isolation check is a verification, not a rating", () => {
  it("the MIRA_CORE isolation clause", () => {
    const a =
      "With the line isolated, locked out and the supply voltage verified at 0 V, check the contactor coil terminals for loose connections.";
    expect(unsupportedExactRating(a)).toBeNull();
  });

  it("control (#4093 Codex F2): a bare zero rating with no verification verb still fires", () => {
    expect(unsupportedExactRating("The maximum output voltage is 0 V.")).not.toBeNull();
    expect(unsupportedExactRating("The operating temperature range is 0 to 0 °C.")).not.toBeNull();
  });

  it("control: a range with a non-zero endpoint still fires", () => {
    expect(unsupportedExactRating("The operating range is 0 to 50 °C.")).toMatch(/0\s*to\s*50/i);
  });
});
