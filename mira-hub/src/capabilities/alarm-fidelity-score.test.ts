import { describe, it, expect } from "vitest";
import { gate, MIN_PHOTOS, scoreScreen } from "./alarm-fidelity-score";
import { SCREEN_FAIL_SAFE, SCREEN_RTD } from "./alarm-screens.fixture";

const truth = SCREEN_FAIL_SAFE;
const replaceFirst = (lines: readonly string[], from: string, to: string): string[] => {
  let done = false;
  return lines.map((l) => {
    if (done || !l.includes(from)) return l;
    done = true;
    return l.replace(from, to);
  });
};

describe("scoreScreen", () => {
  it("a perfect transcription scores perfect and passes the gate", () => {
    const s = scoreScreen(truth, truth);
    expect(s.designationTotal).toBe(12); // 6 wire-break rows × 2 designations; passivations carry none
    expect(s.designationExact).toBe(12);
    expect(s.inventedInCutFields).toBe(0);
    expect(s.recordsTotal).toBe(10);
    expect(s.recordsCorrect).toBe(10);
    expect(gate([s], 1).pass).toBe(true);
  });

  it("a completed cut-off time is an invented character and fails the gate on its own", () => {
    const s = scoreScreen(truth, replaceFirst(truth, "08:14:3…", "08:14:35"));
    expect(s.inventedInCutFields).toBe(1);
    expect(s.designationExact).toBe(12);
    expect(gate([s], 1).pass).toBe(false);
  });

  it("a completed cut-off address is an invented character too", () => {
    expect(scoreScreen(truth, replaceFirst(truth, "F-I/O: 61…", "F-I/O: 6100")).inventedInCutFields).toBe(1);
  });

  it("control: keeping the cut-off marker, as … or ..., invents nothing", () => {
    const dots = truth.map((l) => l.replace(/…/g, "..."));
    expect(scoreScreen(truth, dots).inventedInCutFields).toBe(0);
  });

  it("one designation off by a character costs exactly one", () => {
    const s = scoreScreen(truth, replaceFirst(truth, "=y.CTL+07-K4.1-2.", "=y.CTL+07-K4.1-Z."));
    expect(s.designationExact).toBe(11);
  });

  it("two records run together cost two grouped records", () => {
    const merged = replaceFirst(
      truth,
      "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
      "Safety program: F-I/O channel passivated",
    );
    const s = scoreScreen(truth, merged);
    expect(s.recordsTotal).toBe(10);
    expect(s.recordsCorrect).toBe(8);
  });

  it("one alarm swapped for another of the same size is not grouped correctly", () => {
    const swapped = replaceFirst(truth, "Wire break on Output channel 1", "Wire break on Output channel 5");
    expect(scoreScreen(truth, swapped).recordsCorrect).toBe(9);
  });

  it("scores the RTD screen too (full times, no cut-off fields)", () => {
    const s = scoreScreen(SCREEN_RTD, SCREEN_RTD);
    expect(s.designationTotal).toBe(2);
    expect(s.recordsTotal).toBe(4);
    expect(s.inventedInCutFields).toBe(0);
  });
});

describe("gate", () => {
  it("pools photos: 90 % designations and 90 % grouping across all photos, zero invented", () => {
    const good = scoreScreen(truth, truth);
    const oneTagWrong = scoreScreen(truth, replaceFirst(truth, "=y.CTL+07-K4.1-2.", "=y.CTL+07-K4.1-Z."));
    const g = gate([good, oneTagWrong], 2);
    expect(g.designationRate).toBeCloseTo(23 / 24);
    expect(g.pass).toBe(true);
  });
  it("fails below 90 % grouping", () => {
    const lines = SCREEN_FAIL_SAFE.filter((l) => !l.startsWith("46 ")); // passivation rows lose their prefix
    const g = gate([scoreScreen(truth, lines)], 1);
    expect(g.groupingRate).toBeLessThan(0.9);
    expect(g.pass).toBe(false);
  });
});

describe("gate photo count", () => {
  it(`a run needs at least ${MIN_PHOTOS} photos, however good they are`, () => {
    const perfect = scoreScreen(truth, truth);
    expect(gate([perfect]).pass).toBe(false);
    expect(gate(Array.from({ length: MIN_PHOTOS }, () => perfect)).pass).toBe(true);
    expect(MIN_PHOTOS).toBe(10);
  });
});
