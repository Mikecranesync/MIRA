/**
 * The general-lane exact-rating rule replaced correct answers with "I can't
 * verify that machine-specific detail" (2026-09-28 exam on staging 76887423c;
 * a Q3 re-ask recorded answer_gate.reason = unsupported-specificity:exact-rating,
 * trace 8f88d2c3ff267b2382da35e4e4c53732).
 *
 * The one exemption: an all-zero reading inside an explicit energy-isolation
 * clause ("isolated, locked out and verified at 0 V"), which MIRA_CORE requires
 * in the same sentence as any wiring step (#3959: 4 of 6 staging drafts replaced
 * on that clause alone).
 *
 * There is deliberately NO question-restatement exemption: Codex rounds 1–2 on
 * #4093 broke every free-text version of it. The restatement controls below pin
 * that fail-closed choice.
 */
import { describe, expect, it } from "vitest";

import { unsupportedExactRating, validateAnswer } from "./answer-validation";

function general(answerText: string, question: string) {
  return validateAnswer({ answerText, question, general: true, served: true, refused: false, evidenceSufficient: false });
}

describe("exact-rating: an isolation verification at zero is not a rating", () => {
  it.each([
    "With the line isolated, locked out and the supply voltage verified at 0 V, check the contactor coil terminals for loose connections.",
    "With the drive de-energized and the DC bus voltage confirmed at 0 V, inspect the output terminals.",
    "After lockout/tagout, with the input voltage measured at 0 V, torque the terminal screws.",
    "With the line isolated, locked out and the supply voltage verified at 0 V, check the rated current on the nameplate.",
  ])("%s", (a) => {
    expect(unsupportedExactRating(a)).toBeNull();
    expect(general(a, "Why does the contactor chatter?").ok).toBe(true);
  });
});

describe("exact-rating: controls that must still block", () => {
  it.each([
    ["a zero rating with a verification verb but no isolation (Codex r2 F5)", "The maximum output voltage, verified by our test, is 0 V."],
    ["a bare zero rating (Codex r1 F2)", "The maximum output voltage is 0 V."],
    ["an all-zero range with no isolation", "The operating temperature range is 0 to 0 °C."],
    ["a non-zero endpoint", "The operating range is 0 to 50 °C."],
    ["an isolation sentence carrying a non-zero rating", "With the drive isolated and locked out, the rated output voltage is 460 V."],
    ["isolation words beside a separate zero rating (Codex r3 F1)", "With the line isolated and locked out, the maximum output voltage, verified by our test, is 0 V."],
    ["a rating quantity 'measured at 0 V' (Codex post-cap F1)", "With the line isolated and locked out, the maximum output voltage, measured at 0 V, needs no further testing."],
    ["a rated quantity 'verified at 0 V'", "With the drive isolated, the rated supply voltage verified at 0 V is acceptable."],
    ["a rating claim continuing after the zero reading (post-cap r2 F1)", "With the line isolated and locked out, the output voltage measured at 0 V is the unit peak voltage rating."],
    ["a declarative continuation without a rating word", "With the line isolated and locked out, the output voltage measured at 0 V is the design value."],
    ["the clause continues past the zero instead of ending at a comma", "With the line isolated, locked out and the supply voltage verified at 0 V is fine for this panel."],
    ["an appositive design claim (post-cap r3 F1)", "With the line isolated and locked out, the output voltage measured at 0 V, the unit design voltage."],
  ])("%s", (_label, a) => {
    expect(unsupportedExactRating(a)).not.toBeNull();
  });

  it.each([
    ["relay value moved to the motor (Codex r1 F1 / r2 F1)", "The relay contacts are rated 12 A and the motor current is unknown. What is the motor rated current?", "The motor rated current is 12 A."],
    ["an unsupplied range endpoint (r2 F2)", "A sensor reports 50 °C. What is its operating range?", "The operating range is -20 to 50 °C."],
    ["a sign flip (r2 F3)", "The operating temperature is -20 °C.", "The operating temperature is +20 °C."],
  ])("no restatement exemption: %s", (_label, q, a) => {
    expect(general(a, q).ok).toBe(false);
  });
});
