import { describe, it, expect } from "vitest";
import { jevCandidates, buildReplayFixture, CANDIDATE_RULES_VERSION } from "../jev-candidates";
import type { JevDecisionRecord } from "../jev-decision";

const rec = (signals: Record<string, number>, skipped: string | null = null): JevDecisionRecord => ({
  question_set_version: "decision-fabric-v1",
  state_version: "1",
  model: "jev-1.13.0",
  signals: signals as JevDecisionRecord["signals"],
  failure_class: null,
  failure_class_confidence: null,
  failure_class_probabilities: null,
  latency_ms: 276,
  input_tokens: 1000,
  skipped_reason: skipped,
});

describe("candidates", () => {
  it("fires on the #3966 shape", () => {
    const c = jevCandidates(rec({ wrong_family_grounding: 0.92, family_match: 0.06 }));
    expect(c.map((x) => x.code)).toContain("JEV_WRONG_FAMILY_GROUNDING");
    expect(c[0].value).toBe(0.92);
    expect(c[0].rules_version).toBe(CANDIDATE_RULES_VERSION);
  });

  it("fires on the #3962 shape", () => {
    expect(jevCandidates(rec({ contradicts_observations: 0.82 })).map((x) => x.code))
      .toContain("JEV_CONTRADICTS_OBSERVATIONS");
  });

  it("stays silent on a sound turn", () => {
    expect(jevCandidates(rec({
      follows_evidence: 0.94, family_match: 0.98, wrong_family_grounding: 0.03,
      unsupported_numerics: 0.07, over_specificity: 0.17, contradicts_observations: 0.07,
      answered_the_request: 0.97,
    }))).toEqual([]);
  });

  it("reports SEVERAL candidates when a turn is several kinds of wrong", () => {
    const c = jevCandidates(rec({ wrong_family_grounding: 0.92, contradicts_observations: 0.91, follows_evidence: 0.23 }));
    expect(c).toHaveLength(3);
  });

  it("returns nothing — not 'clean' — for a call that never ran", () => {
    // The distinction this asserts: a skipped judge is an absence of EVIDENCE,
    // and must not be readable as an absence of problems.
    expect(jevCandidates(rec({ wrong_family_grounding: 0.99 }, "timeout"))).toEqual([]);
    expect(jevCandidates(null)).toEqual([]);
    expect(jevCandidates(undefined)).toEqual([]);
  });

  it("honours an overridden threshold, because the defaults are provisional", () => {
    const r = rec({ wrong_family_grounding: 0.6 });
    expect(jevCandidates(r)).toHaveLength(1);
    expect(jevCandidates(r, { thresholds: { wrong_family_grounding: 0.9 } })).toHaveLength(0);
  });
});

describe("the evidence precondition (found on live traffic, not in the fixtures)", () => {
  // The first live run fired JEV_NOT_FOLLOWING_EVIDENCE on 6 of 7 turns, all
  // with citations_shipped: 0 — including correct, hedged answers. With nothing
  // retrieved the question is vacuous, so the rule must stay silent.
  const noEvidenceTurn = rec({ follows_evidence: 0.27, family_match: 0.11, over_specificity: 0.2 });

  it("stays silent about following evidence when there was none", () => {
    expect(jevCandidates(noEvidenceTurn, { evidencePresent: false })).toEqual([]);
  });

  it("still fires when evidence WAS retrieved", () => {
    expect(jevCandidates(noEvidenceTurn, { evidencePresent: true }).map((c) => c.code))
      .toContain("JEV_NOT_FOLLOWING_EVIDENCE");
  });

  it("does not suppress the evidence-INDEPENDENT rules", () => {
    // Over-specificity and invented numerics are judgeable with no evidence at
    // all — indeed that is exactly when they matter most.
    const c = jevCandidates(rec({ over_specificity: 0.9, unsupported_numerics: 0.8, follows_evidence: 0.1 }), { evidencePresent: false });
    expect(c.map((x) => x.code).sort()).toEqual(["JEV_OVER_SPECIFIC", "JEV_UNSUPPORTED_NUMERIC"]);
  });
});

describe("the corpus cannot grow without a person", () => {
  const base = {
    id: "3966-hmi-vfd", confirmedBy: "mike", expectation: "must not cite drive manuals for a panel",
    question: "the screen is blank", jev: rec({ wrong_family_grounding: 0.92 }),
  };

  it("refuses an unattributed fixture", () => {
    expect(() => buildReplayFixture({ ...base, confirmedBy: "  " })).toThrow(/human confirmer/);
  });

  it("refuses a fixture with no human-written expectation", () => {
    expect(() => buildReplayFixture({ ...base, expectation: "" })).toThrow(/expectation/);
  });

  it("keeps the judge's reading as context, not as the assertion", () => {
    const f = buildReplayFixture(base);
    // The thing a future run is checked against is the HUMAN's sentence; the
    // model's numbers ride along so a reviewer can see why it was captured.
    expect(f.expectation).toBe("must not cite drive manuals for a panel");
    expect(f.jev_at_capture.signals.wrong_family_grounding).toBe(0.92);
    expect(f.candidates_at_capture.map((c) => c.code)).toEqual(["JEV_WRONG_FAMILY_GROUNDING"]);
    expect(f.confirmed_by).toBe("mike");
  });
});
