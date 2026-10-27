/**
 * Answer Requirements Gate v1 tests.
 * Per-requirement fail/pass/not-applicable cases; skipped-fabric verdict;
 * flag-off (no jev_decision) returns null; primary_stage ordering; R4
 * deterministic-part-fails-while-JEV-skipped yields fail.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateAnswerRequirements,
  ANSWER_REQUIREMENTS,
  ANSWER_REQUIREMENTS_VERSION,
} from "./answer-requirements";
import type { TurnEvidencePacket } from "./turn-evidence-packet";
import type { JevDecisionRecord } from "./jev-decision";

// Minimal packet: exactly the fields evaluateAnswerRequirements reads (context.chunk_count,
// context.visual_evidence_count, answer_gate.{decision, citations_shipped, ungrounded_unit_claim,
// cited_values_unsupported}, jev_decision). Everything else is irrelevant to the gate, so it is
// cast rather than invented — an invented field would type-check nothing and prove nothing.
type GateView = {
  context: Partial<TurnEvidencePacket["context"]>;
  answer_gate: Partial<TurnEvidencePacket["answer_gate"]>;
  jev_decision?: JevDecisionRecord | null;
};

function makePacket(overrides: Partial<GateView> = {}): TurnEvidencePacket {
  const base: GateView = {
    context: { chunk_count: 5, visual_evidence_count: 0 },
    answer_gate: {
      decision: "answered",
      citations_shipped: 1,
      ungrounded_unit_claim: false,
      cited_values_unsupported: 0,
      safety_classification: "none",
    },
    jev_decision: {
      question_set_version: "decision-fabric-v1",
      state_version: null,
      model: null,
      signals: {
        follows_evidence: 0.6,
        wrong_family_grounding: 0.2,
        contradicts_observations: 0.1,
        unsupported_numerics: 0.3,
        used_strongest_evidence: 0.8,
        ignored_evidence: 0.2,
        over_specificity: 0.5,
        regression_candidate: 0.1,
        needs_human_review: 0.2,
        answered_the_request: 0.9,
      },
      failure_class: null,
      failure_class_confidence: null,
      failure_class_probabilities: null,
      latency_ms: 500,
      input_tokens: 1000,
      skipped_reason: null,
    },
  };
  return { ...base, ...overrides } as unknown as TurnEvidencePacket;
}

describe("evaluateAnswerRequirements", () => {
  it("returns null when jev_decision is absent (flag off)", () => {
    const packet = makePacket({ jev_decision: undefined });
    const result = evaluateAnswerRequirements(packet);
    expect(result).toBeNull();
  });

  it("returns null when jev_decision is null (flag off)", () => {
    const packet = makePacket({ jev_decision: null });
    const result = evaluateAnswerRequirements(packet);
    expect(result).toBeNull();
  });

  it("returns pass when all applicable reqs pass", () => {
    const packet = makePacket();
    const result = evaluateAnswerRequirements(packet);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("pass");
    expect(result!.failed).toHaveLength(0);
    expect(result!.unjudged).toHaveLength(0);
  });

  it("R1_GROUNDED fails when follows_evidence < 0.5 and chunk_count > 0", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          follows_evidence: 0.3,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R1_GROUNDED");
    expect(result.verdict).toBe("fail");
    expect(result.primary_stage).toBe("generation");
  });

  it("R1_GROUNDED not_applicable when chunk_count=0", () => {
    const packet = makePacket({
      context: { ...makePacket().context, chunk_count: 0 },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          follows_evidence: 0.3,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.not_applicable).toContain("R1_GROUNDED");
  });

  it("R2_RIGHT_EQUIPMENT fails when wrong_family_grounding >= 0.5", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          wrong_family_grounding: 0.6,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R2_RIGHT_EQUIPMENT");
    expect(result.primary_stage).toBe("retrieval");
  });

  it("R3_MATCHES_PHOTO fails when contradicts_observations >= 0.5 and visual_evidence_count > 0", () => {
    const packet = makePacket({
      context: { ...makePacket().context, visual_evidence_count: 1 },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          contradicts_observations: 0.7,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R3_MATCHES_PHOTO");
    expect(result.primary_stage).toBe("vision");
  });

  it("R3_MATCHES_PHOTO not_applicable when visual_evidence_count=0", () => {
    const packet = makePacket({
      context: { ...makePacket().context, visual_evidence_count: 0 },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          contradicts_observations: 0.9,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.not_applicable).toContain("R3_MATCHES_PHOTO");
  });

  it("R4_NO_INVENTED_VALUES fails when jev unsupported_numerics >= 0.5", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          unsupported_numerics: 0.6,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R4_NO_INVENTED_VALUES");
  });

  it("R4_NO_INVENTED_VALUES fails when det ungrounded_unit_claim=true", () => {
    const packet = makePacket({
      answer_gate: { ...makePacket().answer_gate, ungrounded_unit_claim: true },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          unsupported_numerics: 0.2,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R4_NO_INVENTED_VALUES");
  });

  it("R4_NO_INVENTED_VALUES fails when det cited_values_unsupported > 0", () => {
    const packet = makePacket({
      answer_gate: { ...makePacket().answer_gate, cited_values_unsupported: 2 },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          unsupported_numerics: 0.2,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R4_NO_INVENTED_VALUES");
  });

  it("R4: det-part-fails while JEV-skipped returns fail", () => {
    const packet = makePacket({
      answer_gate: { ...makePacket().answer_gate, ungrounded_unit_claim: true },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {},
        skipped_reason: "timeout",
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R4_NO_INVENTED_VALUES");
  });

  it("R6_CALIBRATED fails when over_specificity >= 0.7", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          over_specificity: 0.75,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R6_CALIBRATED");
  });

  it("R7_CITED fails when citations_shipped=0 and decision=answered", () => {
    const packet = makePacket({
      answer_gate: { ...makePacket().answer_gate, citations_shipped: 0 },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R7_CITED");
    expect(result.primary_stage).toBe("citation");
  });

  it("R7_CITED not_applicable when decision not answered/served", () => {
    const packet = makePacket({
      answer_gate: {
        ...makePacket().answer_gate,
        decision: "insufficient_evidence",
        citations_shipped: 0,
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.not_applicable).toContain("R7_CITED");
  });

  it("skipped fabric with no failures yields unjudged", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {},
        skipped_reason: "timeout",
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.verdict).toBe("unjudged");
  });

  it("primary_stage order: retrieval < vision < generation < citation", () => {
    const packet = makePacket({
      context: { ...makePacket().context, visual_evidence_count: 1, chunk_count: 5 },
      answer_gate: { ...makePacket().answer_gate, citations_shipped: 0 },
      jev_decision: {
        ...makePacket().jev_decision!,
        signals: {
          ...makePacket().jev_decision!.signals,
          wrong_family_grounding: 0.9,
          contradicts_observations: 0.9,
          follows_evidence: 0.2,
        },
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.failed).toContain("R2_RIGHT_EQUIPMENT");
    expect(result.failed).toContain("R3_MATCHES_PHOTO");
    expect(result.failed).toContain("R1_GROUNDED");
    expect(result.failed).toContain("R7_CITED");
    expect(result.primary_stage).toBe("retrieval");
  });

  it("exports ANSWER_REQUIREMENTS registry with correct structure", () => {
    expect(ANSWER_REQUIREMENTS).toBeDefined();
    expect(Array.isArray(ANSWER_REQUIREMENTS)).toBe(true);
    expect(ANSWER_REQUIREMENTS.length).toBeGreaterThan(0);
    const first = ANSWER_REQUIREMENTS[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("stage");
    expect(first).toHaveProperty("precondition");
    expect(first).toHaveProperty("check");
  });

  it("verdict includes jev_failure_class", () => {
    const packet = makePacket({
      jev_decision: {
        ...makePacket().jev_decision!,
        failure_class: "overreach",
      },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.jev_failure_class).toBe("overreach");
  });

  it("verdict includes version constant", () => {
    const packet = makePacket();
    const result = evaluateAnswerRequirements(packet)!;
    expect(result.version).toBe(ANSWER_REQUIREMENTS_VERSION);
  });

  it("records not_applicable in checks[] even when the check itself would fail (no photo, contradicting signal)", () => {
    const base = makePacket();
    const packet = makePacket({
      context: { chunk_count: 5, visual_evidence_count: 0 },
      jev_decision: { ...base.jev_decision!, signals: { ...base.jev_decision!.signals, contradicts_observations: 0.95 } },
    });
    const result = evaluateAnswerRequirements(packet)!;
    expect(packet.context.visual_evidence_count).toBe(0); // precondition, asserted not assumed
    expect(result.not_applicable).toContain("R3_MATCHES_PHOTO");
    expect(result.checks.find((c) => c.id === "R3_MATCHES_PHOTO")!.status).toBe("not_applicable");
    expect(result.failed).not.toContain("R3_MATCHES_PHOTO");
  });
});

