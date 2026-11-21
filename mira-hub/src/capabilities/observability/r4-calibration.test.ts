import { describe, it, expect } from "vitest";
import { scoreR4Calibration, type HumanLabel, type R4Verdict } from "./r4-calibration";

// Synthetic labels only — never real reviewer data in a fixture.
const key: Record<string, R4Verdict> = { a: "fail", b: "fail", c: "fail", d: "pass", e: "pass", f: "pass", g: "pass", h: "fail" };

describe("scoreR4Calibration", () => {
  it("builds the confusion matrix with R4 fail as the positive prediction", () => {
    const labels: Record<string, HumanLabel> = { a: "yes", b: "yes", c: "no", d: "no", e: "no", f: "yes", g: "no", h: "yes" };
    const r = scoreR4Calibration(key, labels);
    expect([r.tp, r.fp, r.fn, r.tn]).toEqual([3, 1, 1, 3]);
    expect(r.falsePositives).toEqual(["c"]);
    expect(r.falseNegatives).toEqual(["f"]);
    expect(r.precision).toBeCloseTo(0.75);
    expect(r.recall).toBeCloseTo(0.75);
    expect(r.agreement).toBeCloseTo(0.75);
    // pe = (4*4 + 4*4)/64 = 0.5 → kappa = (0.75-0.5)/0.5
    expect(r.kappa).toBeCloseTo(0.5);
  });

  it("excludes unsure and unlabeled turns from the matrix and reports them", () => {
    const r = scoreR4Calibration(key, { a: "yes", b: "unsure", d: "no" });
    expect(r.sample).toBe(8);
    expect(r.scored).toBe(2);
    expect(r.unsure).toEqual(["b"]);
    expect(r.unlabeled).toEqual(["c", "e", "f", "g", "h"]);
    expect([r.tp, r.fp, r.fn, r.tn]).toEqual([1, 0, 0, 1]);
  });

  it("returns null metrics rather than a fake score when nothing is labeled", () => {
    const r = scoreR4Calibration(key, {});
    expect(r.scored).toBe(0);
    expect([r.precision, r.recall, r.agreement, r.kappa]).toEqual([null, null, null, null]);
  });

  it("perfect agreement gives kappa 1; all-disagree gives a negative kappa", () => {
    const perfect: Record<string, HumanLabel> = Object.fromEntries(Object.entries(key).map(([k, v]) => [k, v === "fail" ? "yes" : "no"]));
    expect(scoreR4Calibration(key, perfect).kappa).toBeCloseTo(1);
    const inverted: Record<string, HumanLabel> = Object.fromEntries(Object.entries(key).map(([k, v]) => [k, v === "fail" ? "no" : "yes"]));
    expect(scoreR4Calibration(key, inverted).kappa!).toBeLessThan(0);
  });
});
