/**
 * #4372 safety Phase 1, round 2: NUM-1 now decides the turn for approach_boundary (most
 * conservative = largest distance), incident_energy (largest cal/cm²) and pressure (no safe
 * direction: an exact cited value, or one carrying the source's own condition). Torque stays
 * deferred (reported, never decides). A1–A5 apply to every enforced quantity.
 *
 * Source sentences are implementer-written paraphrases (no manual in imib-manuals states these
 * quantities numerically); rating conditions are hp/kW only, so the condition cases are synthetic.
 */
import { describe, expect, it } from "vitest";
import { extractNumbers } from "./extract";
import { numberSafeFallback } from "./render";
import { verifyNumbers } from "./verify";
import { ENFORCED_QUANTITIES, type BoundAsset, type EvidenceChunk, type Quantity } from "./types";
import * as F from "./dev-fixtures";

function check(answerText: string, chunks: EvidenceChunk[], bound: BoundAsset | null = F.GS10, question = "") {
  const ex = extractNumbers({ answerText, chunks, bound, question });
  return verifyNumbers({ numbers: ex.numbers, unparsed: ex.unparsed, chunks, bound, question });
}
const verdicts = (r: ReturnType<typeof check>) => r.checks.map((c) => c.verdict);
const src = (content: string, id = "c1", extra: Partial<EvidenceChunk> = {}) =>
  F.manualChunk(id, content, F.GS10, F.GS10_SHA, "2-14", extra);

interface QCase {
  q: Quantity;
  source: string;
  pass: string;
  wrong: string;
  /** A second applicable source stating a different value. */
  other: string;
  /** Cites [2] (the other source): the safer value for max quantities. */
  otherAnswer: string;
  conditioned: string;
  conditionedAnswer: string;
  unconditionedAnswer: string;
}

const CASES: QCase[] = [
  {
    q: "approach_boundary",
    source: "The limited approach boundary for this panel is 42 inches.",
    pass: "Stay outside the limited approach boundary of 42 inches [1].",
    wrong: "Stay outside the limited approach boundary of 36 inches [1].",
    other: "For the line-side compartment the limited approach boundary is 60 inches.",
    otherAnswer: "Stay outside the limited approach boundary of 60 inches [2].",
    conditioned: "The arc flash boundary is 18 inches for drives rated 30 hp or less and 36 inches for drives rated 40 hp or more.",
    conditionedAnswer: "For drives rated 30 hp or less, the arc flash boundary is 18 inches [1].",
    unconditionedAnswer: "The arc flash boundary is 18 inches [1].",
  },
  {
    q: "incident_energy",
    source: "Incident energy at the load-side bus is 8 cal/cm².",
    pass: "The label gives an incident energy of 8 cal/cm² [1].",
    wrong: "The label gives an incident energy of 4 cal/cm² [1].",
    other: "Incident energy at the line-side lugs is 25 cal/cm².",
    otherAnswer: "Plan PPE for an incident energy of 25 cal/cm² [2].",
    conditioned: "Incident energy is 8 cal/cm² for drives rated 30 hp or less and 12 cal/cm² for drives rated 40 hp or more.",
    conditionedAnswer: "For drives rated 30 hp or less, incident energy is 8 cal/cm² [1].",
    unconditionedAnswer: "Incident energy is 8 cal/cm² [1].",
  },
  {
    q: "pressure",
    source: "The accumulator precharge pressure is 1,000 psi.",
    pass: "The accumulator is precharged to 1,000 psi [1].",
    wrong: "The accumulator is precharged to 1,200 psi [1].",
    other: "The pump relief valve is set at 1,500 psi.",
    otherAnswer: "The relief valve is set at 1,500 psi [2].",
    conditioned: "Precharge is 1,000 psi for units rated 30 hp or less and 1,500 psi for units rated 40 hp or more.",
    conditionedAnswer: "For units rated 30 hp or less, precharge the accumulator to 1,000 psi [1].",
    unconditionedAnswer: "Precharge the accumulator to 1,000 psi [1].",
  },
];

describe("enforced quantities", () => {
  it("approach_boundary, incident_energy and pressure are enforced; torque stays deferred", () => {
    expect([...ENFORCED_QUANTITIES].sort()).toEqual(
      ["approach_boundary", "discharge_time", "incident_energy", "pressure", "residual_voltage"].sort(),
    );
    expect(ENFORCED_QUANTITIES).not.toContain("torque");
  });
});

describe.each(CASES)("NUM-1 / NUM-2 for $q", (c) => {
  it("pass: the cited applicable source states the value; the turn passes", () => {
    const r = check(c.pass, [src(c.source)]);
    expect(r.checks.map((k) => [k.number?.quantity, k.verdict, k.enforced])).toEqual([[c.q, "pass", true]]);
    expect(r.verdict).toBe("pass");
  });

  it("block: a value the cited source does not state decides the turn", () => {
    const r = check(c.wrong, [src(c.source)]);
    expect(verdicts(r)).toEqual(["block:not_in_cited_sentence"]);
    expect(r.verdict).toBe("block");
  });

  it("block: an uncited value has no source", () => {
    expect(check(c.pass.replace(" [1]", ""), [src(c.source)]).verdict).toBe("block");
  });

  it("conflicting applicable sources: the most conservative value, or none for pressure", () => {
    const chunks = [src(c.source, "c1"), src(c.other, "c2")];
    if (c.q === "pressure") {
      // No safe direction: neither value can be chosen without the source's own condition.
      expect(verdicts(check(c.pass, chunks))).toEqual(["block:no_safe_direction"]);
      expect(verdicts(check(c.otherAnswer, chunks))).toEqual(["block:no_safe_direction"]);
    } else {
      // Max direction: the smaller distance / energy is not the conservative one.
      expect(verdicts(check(c.pass, chunks))).toEqual(["block:not_most_conservative"]);
      expect(verdicts(check(c.otherAnswer, chunks))).toEqual(["pass_most_conservative"]);
    }
  });

  it("condition: the value with the source's own rating condition passes; dropped, it blocks", () => {
    expect(verdicts(check(c.conditionedAnswer, [src(c.conditioned)]))).toEqual(["pass_conditioned"]);
    const dropped = verdicts(check(c.unconditionedAnswer, [src(c.conditioned)]));
    expect(dropped).toEqual([c.q === "pressure" ? "block:no_safe_direction" : "block:not_most_conservative"]);
    // a known rating resolves it: the 40-hp value no longer applies to a 5 hp asset
    const r5 = check(c.unconditionedAnswer, [src(c.conditioned)], { ...F.GS10, rating: { value: 5, unit: "hp" } });
    expect(verdicts(r5)).toEqual(["pass_conditioned"]);
  });

  it.each([
    ["A1 technician-origin chunk", { origin: "technician" as const }, F.GS10, "block:technician_number"],
    ["A2 vendor_fallback", { retrievalScope: "vendor_fallback" as const }, F.GS10, "block:vendor_fallback"],
    ["A3 another model's chunk", { modelNumber: "GS4" }, F.GS10, "block:not_bound_asset"],
    ["A3 no bound asset", {}, null, "block:not_bound_asset"],
    ["A4 unverified", { verified: false }, F.GS10, "block:unverified_source"],
    ["A5 no page", { pageLabel: null }, F.GS10, "block:no_page"],
  ] as const)("%s blocks", (_n, extra, bound, verdict) => {
    const r = check(c.pass, [src(c.source, "c1", extra)], bound);
    expect(verdicts(r)).toEqual([verdict]);
    expect(r.verdict).toBe("block");
  });

  it("A1 the technician's own number in the question is not support", () => {
    const question = c.pass.replace(" [1]", "") + " Is that right?";
    expect(verdicts(check(c.pass.replace(" [1]", ""), [], F.GS10, question))).toEqual(["block:technician_number"]);
  });
});

describe("value tolerance for converted units rounds only toward the conservative side", () => {
  const boundary = [src("The limited approach boundary for this panel is 42 inches.")];
  it("approach (max): 1.07 m for 42 in (rounded up) passes; 1.06 m (rounded down) blocks", () => {
    expect(verdicts(check("The limited approach boundary is 1.07 m [1].", boundary))).toEqual(["pass"]);
    expect(verdicts(check("The limited approach boundary is 1.06 m [1].", boundary))).toEqual(["block:not_in_cited_sentence"]);
  });

  it("pressure (no direction): a conversion within 1% either way passes; beyond it blocks", () => {
    const p = [src("Set the regulator to 100 psi.")];
    expect(verdicts(check("Set the regulator to 6.9 bar [1].", p))).toEqual(["pass"]); // +0.08%
    expect(verdicts(check("Set the regulator to 689 kPa [1].", p))).toEqual(["pass"]); // -0.07%
    expect(verdicts(check("Set the regulator to 6.8 bar [1].", p))).toEqual(["block:not_in_cited_sentence"]);
  });
});

describe("precision of the newly enforced quantities", () => {
  it.each([
    ["mounting clearance", "Mount the drive with 50 mm clearance above and below."],
    ["a working distance is not an approach boundary", "Incident energy is calculated at a working distance of 18 inches."],
  ])("%s: no approach boundary is extracted", (_n, answer) => {
    const q = extractNumbers({ answerText: answer, chunks: [], bound: F.GS10 }).numbers.map((n) => n.quantity);
    expect(q).not.toContain("approach_boundary");
  });

  it("pinned (owner decision pending): '0 psi' with no source blocks — no absence-of-pressure rule yet", () => {
    const r = check("Bleed the accumulator to 0 psi and confirm the gauge reads 0 psi.", []);
    expect(r.checks.map((k) => [k.number?.quantity, k.verdict])).toEqual([
      ["pressure", "block:no_source"],
      ["pressure", "block:no_source"],
    ]);
  });

  it("torque still never decides the turn", () => {
    const r = check("Torque the terminals to 4.4 lb-in [1].", [src("Tighten to 4.4 lb-in.")]);
    expect(r.checks.every((k) => !k.enforced)).toBe(true);
    expect(r.verdict).toBe("no_numbers");
  });
});

describe("numberSafeFallback renders the DC-bus procedure only for a DC-bus block", () => {
  it("a pressure or arc-flash block gets a quantity-neutral line, never the capacitor procedure", () => {
    for (const [answer, chunks] of [
      ["Precharge the accumulator to 1,200 psi [1].", [src("The accumulator precharge pressure is 1,000 psi.")]],
      ["The arc flash boundary is 2 ft [1].", [src("The arc flash boundary is 42 inches.")]],
    ] as const) {
      const r = check(answer, [...chunks]);
      expect(r.verdict).toBe("block");
      const text = numberSafeFallback(r, { chunks: [...chunks], bound: F.GS10 })!;
      expect(text).not.toMatch(/DC\+|capacitor|discharge/i);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/\bsafe\b/i);
    }
  });

  it("a discharge-time block still gets the DC-bus procedure, even with a pressure block beside it", () => {
    const chunks = [F.gs10p64("c1"), src("The accumulator precharge pressure is 1,000 psi.", "c2")];
    const r = check("Wait 3 minutes for the capacitors to discharge [1]. Precharge to 1,200 psi [2].", chunks);
    expect(numberSafeFallback(r, { chunks, bound: F.GS10 })).toMatch(/measure DC\+ to DC-/);
  });
});
