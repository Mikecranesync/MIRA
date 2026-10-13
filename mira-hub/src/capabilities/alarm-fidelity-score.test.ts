import { describe, it, expect } from "vitest";
import { gate, MIN_PHOTOS, RUN_PLAN, scoreScreen, type ScreenScore } from "./alarm-fidelity-score";

const fs = (score: ScreenScore) => ({ screen: "failsafe", score });
const ONE = { failsafe: 1 };
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
    expect(gate([fs(s)], ONE).pass).toBe(true);
  });

  it("a completed cut-off time is an invented character and fails the gate on its own", () => {
    const s = scoreScreen(truth, replaceFirst(truth, "08:14:3…", "08:14:35"));
    expect(s.inventedInCutFields).toBe(1);
    expect(s.designationExact).toBe(12);
    expect(gate([fs(s)], ONE).pass).toBe(false);
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

  it("a designation line that moves to another alarm is not grouped correctly", () => {
    // Swap the continuation lines of the first channel-1 and first channel-4 records.
    const lines = [...truth];
    const a = lines.indexOf("=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.");
    const b = lines.indexOf("=y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.");
    [lines[a], lines[b]] = [lines[b], lines[a]];
    const s = scoreScreen(truth, lines);
    expect(s.designationExact).toBe(12); // the tag multiset is unchanged — only grouping can see this
    expect(s.recordsCorrect).toBe(8);
  });

  it("control: punctuation and case slips are not grouping errors", () => {
    const sloppy = truth.map((l) => l.replace("Error:", "error;"));
    expect(scoreScreen(truth, sloppy).recordsCorrect).toBe(10);
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
    const g = gate([fs(good), fs(oneTagWrong)], { failsafe: 2 });
    expect(g.designationRate).toBeCloseTo(23 / 24);
    expect(g.pass).toBe(true);
  });
  it("fails below 90 % grouping", () => {
    const lines = SCREEN_FAIL_SAFE.filter((l) => !l.startsWith("46 ")); // passivation rows lose their prefix
    const g = gate([fs(scoreScreen(truth, lines))], ONE);
    expect(g.groupingRate).toBeLessThan(0.9);
    expect(g.pass).toBe(false);
  });
});

describe("gate run plan", () => {
  const perfectFs = { screen: "failsafe", score: scoreScreen(truth, truth) };
  const perfectRtd = { screen: "rtd", score: scoreScreen(SCREEN_RTD, SCREEN_RTD) };
  const times = <T,>(n: number, x: T) => Array.from({ length: n }, () => x);

  it("the run plan is the capture sheet's 6 fail-safe + 4 RTD photos", () => {
    expect(RUN_PLAN).toEqual({ failsafe: 6, rtd: 4 });
    expect(MIN_PHOTOS).toBe(10);
  });
  it("one perfect photo is not a run", () => {
    expect(gate([perfectFs]).pass).toBe(false);
  });
  it("ten perfect photos of one screen are not a run — the other screen was never measured", () => {
    const g = gate(times(10, perfectFs));
    expect(g.pass).toBe(false);
    expect(g.offPlanScreens).toEqual(["failsafe", "rtd"]);
  });
  it("control: 6 fail-safe + 4 RTD perfect photos pass", () => {
    const g = gate([...times(6, perfectFs), ...times(4, perfectRtd)]);
    expect(g.offPlanScreens).toEqual([]);
    expect(g.pass).toBe(true);
  });
  it("extra photos are off plan — they could dilute failures in the planned ten", () => {
    const g = gate([...times(6, perfectFs), ...times(4, perfectRtd), ...times(5, perfectFs)]);
    expect(g.offPlanScreens).toEqual(["failsafe"]);
    expect(g.pass).toBe(false);
  });
  it("a photo of a screen not in the plan is off plan", () => {
    const g = gate([...times(6, perfectFs), ...times(4, perfectRtd), { screen: "other", score: perfectFs.score }]);
    expect(g.offPlanScreens).toEqual(["other"]);
    expect(g.pass).toBe(false);
  });
});
