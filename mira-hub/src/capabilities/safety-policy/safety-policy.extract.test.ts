/**
 * #4372 safety Phase 1 — shadow extractor: deterministic typed numbers from a generated answer.
 * Fail-closed recall (a discharge claim in any phrasing is extracted) with controls that keep
 * unrelated timing out (ramps, fault resets, recharging).
 */
import { describe, expect, it } from "vitest";
import { citedIds, extractNumbers } from "./extract";
import { sentences } from "./text";
import * as F from "./dev-fixtures";

const ex = (answerText: string, question = "") => extractNumbers({ answerText, question, chunks: [F.gs10p64()], bound: F.GS10 });
const values = (answerText: string, question = "") => ex(answerText, question).numbers.map((n) => [n.quantity, n.value]);

describe("extractor — what counts as a discharge-time claim", () => {
  it.each([
    ["Wait 5 minutes for the capacitors to discharge.", 300],
    ["The caps can remain charged for five minutes.", 300],
    ["Give the DC bus half an hour to bleed down.", 1800],
    ["Allow 5-minute discharge of the bus capacitors.", 300],
    ["Wait five (5) minutes after power is removed before touching the terminals.", 300],
    ["Wait 120 seconds after power is removed before you open the cover.", 120],
    ["Wait\u00A0FIVE\u2011minutes for the capacitors\u200B to discharge.", 300],
  ])("extracts %j", (answer, seconds) => {
    expect(values(answer)).toEqual([["discharge_time", seconds]]);
  });

  it("extracts both ends of a range", () => {
    expect(values("Wait 3 to 5 minutes for the capacitors to discharge.")).toEqual([
      ["discharge_time", 180],
      ["discharge_time", 300],
    ]);
  });

  it("stored-energy context carries through the paragraph and from the question", () => {
    expect(values("Open the disconnect.\nThe DC bus stays charged.\nGive it 10 minutes.")).toEqual([["discharge_time", 600]]);
    expect(values("Give it 10 minutes.", "How long until the DC bus capacitors discharge?")).toEqual([["discharge_time", 600]]);
    // control: a blank line is a topic change and there is no stored-energy question
    expect(values("The DC bus stays charged.\n\nGive it 10 minutes.")).toEqual([]);
  });

  it.each([
    ["Set the decel time to 10 seconds; the DC bus capacitors are unaffected."],
    ["Apply input power for 2 hours to recharge the DC link capacitors."],
    ["Wait 5 seconds after a fault has been cleared before performing reset, then check the capacitors."],
    ["The cooling fan runs for 3 minutes after stop; the capacitors are fine."],
  ])("does not extract unrelated timing: %j", (answer) => {
    expect(values(answer)).toEqual([]);
  });

  it("unparsed durations in a stored-energy clause are reported (SYS-2), not dropped", () => {
    expect(ex("Wait a few minutes for the capacitors to discharge.").unparsed).toEqual(["discharge_time"]);
    expect(ex("Wait several minutes; the DC bus capacitors bleed down slowly.").unparsed).toEqual(["discharge_time"]);
    expect(ex("Wait 10 minutes for the capacitors to discharge.").unparsed).toEqual([]);
  });

  it("residual-voltage thresholds: the value after a threshold word, not a running bus voltage", () => {
    expect(values("The bus runs near 650 VDC, so measure DC+ to DC- and wait until it falls below 50 VDC.")).toEqual([
      ["residual_voltage", 50],
    ]);
    expect(values("The drive is rated 480 VAC.")).toEqual([]);
  });

  it("deferred quantities are extracted with canonical units", () => {
    const n = ex("Torque the terminals to 4.4 lb-in. The air must be below 90 psi. The arc flash boundary is 42 in. away; incident energy is 8 cal/cm².").numbers;
    expect(n.map((x) => x.quantity)).toEqual(["torque", "pressure", "approach_boundary", "incident_energy"]);
    expect(n[0].value).toBeCloseTo(0.497, 3);
    expect(n[2].value).toBeCloseTo(1066.8, 1);
  });
});

describe("extractor — citations and conditions", () => {
  it("parses [n], [n][m], [n, m] and [photo]", () => {
    expect(citedIds("Wait [1][2], see [3, 4] and [photo].")).toEqual(["c1", "c2", "c3", "c4", "photo"]);
  });

  it("a marker after the period belongs to its sentence", () => {
    const n = ex("Wait 10 minutes for the capacitors to discharge. [1]").numbers;
    expect(n.map((x) => x.sourceChunkId)).toEqual(["c1"]);
  });

  it("picks the cited chunk that states the value when several are cited", () => {
    const n = extractNumbers({
      answerText: "Wait 10 minutes for the capacitors to discharge [1][2].",
      chunks: [F.gs10th1o("c1"), F.gs10p64("c2")],
      bound: F.GS10,
    }).numbers;
    expect(n.map((x) => x.sourceChunkId)).toEqual(["c2"]);
  });

  it("any-applicable attribution (replay diagnostic) finds an applicable stating chunk; cited mode does not", () => {
    const opts = { answerText: "Wait 10 minutes for the capacitors to discharge.", chunks: [F.gs10p64("c2")], bound: F.GS10 };
    expect(extractNumbers(opts).numbers[0].sourceChunkId).toBeNull();
    expect(extractNumbers({ ...opts, attribution: "any-applicable" }).numbers[0].sourceChunkId).toBe("c2");
    expect(
      extractNumbers({ ...opts, chunks: [F.gs10p64("c2", { retrievalScope: "vendor_fallback" })], attribution: "any-applicable" }).numbers[0]
        .sourceChunkId,
    ).toBeNull();
  });

  it.each([
    ["For drives rated 30 hp or less, wait 5 minutes for the capacitors to discharge.", { op: "le", value: 30, unit: "hp" }],
    ["Wait 5 minutes for ≤ 30hp models to let the capacitors discharge.", { op: "le", value: 30, unit: "hp" }],
    ["Wait 10 minutes (40 hp or more) for the capacitors to discharge.", { op: "ge", value: 40, unit: "hp" }],
    ["Wait 10 minutes for the capacitors to discharge.", undefined],
  ])("condition of %j", (answer, condition) => {
    expect(ex(answer).numbers[0].condition).toEqual(condition);
  });
});

describe("source sentences", () => {
  it("wrapped PDF lines join into one sentence; ☑ bullets split", () => {
    const s = sentences(F.GS10_P6_3, true);
    expect(s).toContain(
      "When the power is off after 5 minutes for ≤ 30hp models and 10 minutes for ≥ 40hp models, please confirm that the capacitors have fully discharged by measuring the voltage between + and -.",
    );
    expect(s).toContain("Wait 5 seconds after a fault has been cleared before performing reset via keypad or input terminal.");
  });
});
