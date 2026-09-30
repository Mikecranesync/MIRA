/**
 * #4122 — the scorer, proven before any detector is trusted: the labels
 * themselves must score P = R = 1, a never-fire detector R = 0, and the
 * current validateAnswer is recorded as the baseline.
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";
import { loadLabeledSet, score } from "./step-energy-labeled-set";

const rows = loadLabeledSet();
const flagged = (answerText: string, question: string) => {
  const v = validateAnswer({ answerText, question, general: true, served: true, refused: false, evidenceSufficient: false });
  return !v.ok && (v.kind === "energized_warning" || v.kind === "unsafe_answer" || v.kind === "hazard_warning");
};

describe("#4122 step-energy scorer", () => {
  it("loads 140 labeled answers from both sets", () => {
    expect(rows.length).toBe(140);
    expect(rows.filter((r) => r.set === "set1").length).toBe(70);
    expect(rows.filter((r) => r.contradiction).length).toBeGreaterThan(20);
  });

  it("positive control: the labels themselves score P = R = 1", () => {
    const s = score(rows, (r) => r.contradiction);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });

  it("negative control: a detector that never fires has recall 0", () => {
    expect(score(rows, () => false).recall).toBe(0);
  });

  it("validateAnswer as wired (recorded, not gated)", () => {
    const s = score(rows, (r) => flagged(r.answer, r.question));
    console.log("BASELINE validateAnswer", JSON.stringify(s));
    expect(s.tp + s.fp + s.fn + s.tn).toBe(140);
  });

  it("gate: stepEnergyContradiction holds precision >= 0.85 and recall >= 0.60 on the labeled set", () => {
    const s = score(rows, (r) => stepEnergyContradiction(r.answer) !== null);
    console.log("STEP-ENERGY", JSON.stringify(s));
    expect(s.precision).toBeGreaterThanOrEqual(0.85);
    expect(s.recall).toBeGreaterThanOrEqual(0.6);
  });
});
