/**
 * Deterministic anomaly detection — each predicate positive + negative, plus
 * the Pixel 2026-09-22 fixture table (design §5).
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/anomalies.test.ts
 */
import { describe, expect, it } from "vitest";
import { detectAnomalies, ungroundedUnitClaim, type AnomalyCode } from "../anomalies";
import { emptyPacket, type TurnEvidencePacket } from "../turn-evidence-packet";

import turn1 from "../__fixtures__/pixel-2026-09-22/turn1.json";
import turn2 from "../__fixtures__/pixel-2026-09-22/turn2.json";
import turn3 from "../__fixtures__/pixel-2026-09-22/turn3.json";

const BASE_INIT = {
  kind: "chat" as const,
  environment: "staging",
  git_sha: "dd41c7f8e3bac27fc0b8f2bcdbbbc4ebdb5bbf2c",
  service_version: "v3.351.7",
  tenant_id: "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe",
  notebook_id: "93d8c68e-d252-451d-8b52-e0a830543437",
};

function codesOf(p: TurnEvidencePacket, opts?: Parameters<typeof detectAnomalies>[1]): AnomalyCode[] {
  return detectAnomalies(p, opts)
    .map((a) => a.code)
    .sort();
}

describe("detectAnomalies — the Pixel 2026-09-22 fixture table", () => {
  it("turn1: EQUIPMENT_ANSWER_WITH_NO_EVIDENCE + VISUAL_EVIDENCE_DROPPED + GENERIC_ANSWER_UNGROUNDED_CLAIM", () => {
    expect(codesOf(turn1 as unknown as TurnEvidencePacket)).toEqual(
      [
        "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE",
        "GENERIC_ANSWER_UNGROUNDED_CLAIM",
        "VISUAL_EVIDENCE_DROPPED",
      ].sort(),
    );
  });

  it("turn2: VISUAL_EVIDENCE_DROPPED + EQUIPMENT_ANSWER_WITH_NO_EVIDENCE + IDENTITY_PIPELINE_DROPPED", () => {
    expect(codesOf(turn2 as unknown as TurnEvidencePacket)).toEqual(
      [
        "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE",
        "IDENTITY_PIPELINE_DROPPED",
        "VISUAL_EVIDENCE_DROPPED",
      ].sort(),
    );
  });

  it("turn3: VISUAL_EVIDENCE_DROPPED + EQUIPMENT_ANSWER_WITH_NO_EVIDENCE + GENERIC_ANSWER_UNGROUNDED_CLAIM", () => {
    expect(codesOf(turn3 as unknown as TurnEvidencePacket)).toEqual(
      [
        "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE",
        "GENERIC_ANSWER_UNGROUNDED_CLAIM",
        "VISUAL_EVIDENCE_DROPPED",
      ].sort(),
    );
  });

  it("no fixture fires STAGING_TO_PROD_ROUTE without productionRouteVars", () => {
    for (const fixture of [turn1, turn2, turn3]) {
      expect(codesOf(fixture as unknown as TurnEvidencePacket)).not.toContain("STAGING_TO_PROD_ROUTE");
    }
  });
});

describe("PHOTO_WITH_NO_OBSERVATIONS", () => {
  it("fires on a look turn: a file was uploaded, vision ran, but produced no text", () => {
    const p = emptyPacket({ ...BASE_INIT, kind: "look" });
    p.ids.file_ids = ["f1"];
    p.vision.ran = true;
    p.vision.observation_chars = 0;
    expect(codesOf(p)).toContain("PHOTO_WITH_NO_OBSERVATIONS");
  });

  it("fires on a chat turn: visual evidence is claimed but no observation is available", () => {
    const p = emptyPacket(BASE_INIT);
    p.request.has_visual_evidence = true;
    p.visual_evidence.observation_available = false;
    expect(codesOf(p)).toContain("PHOTO_WITH_NO_OBSERVATIONS");
  });

  it("does NOT fire when vision produced observation text", () => {
    const p = emptyPacket({ ...BASE_INIT, kind: "look" });
    p.ids.file_ids = ["f1"];
    p.vision.ran = true;
    p.vision.observation_chars = 200;
    expect(codesOf(p)).not.toContain("PHOTO_WITH_NO_OBSERVATIONS");
  });

  it("does NOT fire on a plain text turn with no visual evidence claimed", () => {
    const p = emptyPacket(BASE_INIT);
    expect(codesOf(p)).not.toContain("PHOTO_WITH_NO_OBSERVATIONS");
  });
});

describe("VISUAL_EVIDENCE_DROPPED", () => {
  it("fires when an observation exists but context carried none of it", () => {
    const p = emptyPacket(BASE_INIT);
    p.visual_evidence.observation_available = true;
    p.context.visual_evidence_count = 0;
    expect(codesOf(p)).toContain("VISUAL_EVIDENCE_DROPPED");
  });

  it("fires from a PRIOR turn's observation count alone", () => {
    const p = emptyPacket(BASE_INIT);
    p.visual_evidence.observation_available = false;
    p.visual_evidence.prior_turn_observation_count = 2;
    p.context.visual_evidence_count = 0;
    expect(codesOf(p)).toContain("VISUAL_EVIDENCE_DROPPED");
  });

  it("does NOT fire when the observation reached context", () => {
    const p = emptyPacket(BASE_INIT);
    p.visual_evidence.observation_available = true;
    p.context.visual_evidence_count = 1;
    expect(codesOf(p)).not.toContain("VISUAL_EVIDENCE_DROPPED");
  });

  it("does NOT fire when there was never any observation to drop", () => {
    const p = emptyPacket(BASE_INIT);
    expect(codesOf(p)).not.toContain("VISUAL_EVIDENCE_DROPPED");
  });
});

describe("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE", () => {
  it("fires when identity is resolved, MIRA answered, and no evidence backs it", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.state = "verified";
    p.answer_gate.decision = "answered";
    expect(codesOf(p)).toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("fires from has_visual_evidence alone, even with identity unknown", () => {
    const p = emptyPacket(BASE_INIT);
    p.request.has_visual_evidence = true;
    p.answer_gate.decision = "answered";
    expect(codesOf(p)).toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("does NOT fire when a doc or visual evidence backs the answer", () => {
    const p = emptyPacket(BASE_INIT);
    p.request.has_visual_evidence = true;
    p.answer_gate.decision = "answered";
    p.context.evidence_doc_ids = ["doc1"];
    expect(codesOf(p)).not.toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("does NOT fire when MIRA did not answer (e.g. insufficient_evidence)", () => {
    const p = emptyPacket(BASE_INIT);
    p.request.has_visual_evidence = true;
    p.answer_gate.decision = "insufficient_evidence";
    expect(codesOf(p)).not.toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });

  it("does NOT fire on a plain general question with no equipment signal", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "answered";
    expect(codesOf(p)).not.toContain("EQUIPMENT_ANSWER_WITH_NO_EVIDENCE");
  });
});

describe("IDENTITY_PIPELINE_DROPPED", () => {
  it("fires when identity ran, had a signal, ended unknown, and recorded no reason", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.ran = true;
    p.visual_evidence.observation_available = true;
    p.identity.state = "unknown";
    p.identity.unresolved_reason = null;
    expect(codesOf(p)).toContain("IDENTITY_PIPELINE_DROPPED");
  });

  it("fires from candidate_count alone", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.ran = true;
    p.identity.candidate_count = 2;
    p.identity.state = "unknown";
    expect(codesOf(p)).toContain("IDENTITY_PIPELINE_DROPPED");
  });

  it("does NOT fire when identity never ran", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.ran = false;
    p.visual_evidence.observation_available = true;
    expect(codesOf(p)).not.toContain("IDENTITY_PIPELINE_DROPPED");
  });

  it("does NOT fire when an unresolved_reason was recorded", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.ran = true;
    p.visual_evidence.observation_available = true;
    p.identity.state = "unknown";
    p.identity.unresolved_reason = "not_bound";
    expect(codesOf(p)).not.toContain("IDENTITY_PIPELINE_DROPPED");
  });

  it("does NOT fire when identity actually resolved", () => {
    const p = emptyPacket(BASE_INIT);
    p.identity.ran = true;
    p.visual_evidence.observation_available = true;
    p.identity.state = "verified";
    expect(codesOf(p)).not.toContain("IDENTITY_PIPELINE_DROPPED");
  });
});

describe("STAGING_TO_PROD_ROUTE", () => {
  it("fires only when environment is staging AND productionRouteVars is non-empty", () => {
    const p = emptyPacket({ ...BASE_INIT, environment: "staging" });
    expect(codesOf(p, { productionRouteVars: ["OTEL_EXPORTER_OTLP_ENDPOINT"] })).toContain(
      "STAGING_TO_PROD_ROUTE",
    );
  });

  it("does NOT fire on staging with an empty productionRouteVars list", () => {
    const p = emptyPacket({ ...BASE_INIT, environment: "staging" });
    expect(codesOf(p, { productionRouteVars: [] })).not.toContain("STAGING_TO_PROD_ROUTE");
  });

  it("does NOT fire on staging when productionRouteVars is omitted entirely", () => {
    const p = emptyPacket({ ...BASE_INIT, environment: "staging" });
    expect(codesOf(p)).not.toContain("STAGING_TO_PROD_ROUTE");
  });

  it("does NOT fire outside staging even with a non-empty productionRouteVars list", () => {
    const p = emptyPacket({ ...BASE_INIT, environment: "production" });
    expect(codesOf(p, { productionRouteVars: ["OTEL_EXPORTER_OTLP_ENDPOINT"] })).not.toContain(
      "STAGING_TO_PROD_ROUTE",
    );
  });
});

describe("GENERIC_ANSWER_UNGROUNDED_CLAIM", () => {
  it("fires when MIRA answered with a unit claim, no retrieval, no image", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "answered";
    p.retrieval.executed = false;
    p.generation.has_image_input = false;
    p.answer_gate.ungrounded_unit_claim = true;
    expect(codesOf(p)).toContain("GENERIC_ANSWER_UNGROUNDED_CLAIM");
  });

  it("does NOT fire when retrieval actually ran", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "answered";
    p.retrieval.executed = true;
    p.answer_gate.ungrounded_unit_claim = true;
    expect(codesOf(p)).not.toContain("GENERIC_ANSWER_UNGROUNDED_CLAIM");
  });

  it("does NOT fire when an image reached generation", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "answered";
    p.retrieval.executed = false;
    p.generation.has_image_input = true;
    p.answer_gate.ungrounded_unit_claim = true;
    expect(codesOf(p)).not.toContain("GENERIC_ANSWER_UNGROUNDED_CLAIM");
  });

  it("does NOT fire when the answer made no unit claim", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "answered";
    p.retrieval.executed = false;
    p.generation.has_image_input = false;
    p.answer_gate.ungrounded_unit_claim = false;
    expect(codesOf(p)).not.toContain("GENERIC_ANSWER_UNGROUNDED_CLAIM");
  });
});

describe("ungroundedUnitClaim — the regex, over real answer text", () => {
  it('matches "2.5 in" (turn1)', () => {
    expect(ungroundedUnitClaim("part number X0026705, width 2.5 in, made in China")).toBe(true);
  });

  it('matches "60 °C" (turn3)', () => {
    expect(ungroundedUnitClaim("often –20 °C to +60 °C for industrial HMIs")).toBe(true);
  });

  it('does NOT match "24 VDC" — no word boundary between V and DC', () => {
    expect(ungroundedUnitClaim("disconnect the 24 VDC supply to the panel")).toBe(false);
  });

  it("does NOT match plain text with no unit claim", () => {
    expect(ungroundedUnitClaim("Check the connector for damage or corrosion.")).toBe(false);
  });

  it("is a pure function — same input, same output, no side effects", () => {
    const text = "width 2.5 in";
    expect(ungroundedUnitClaim(text)).toBe(ungroundedUnitClaim(text));
  });
});

describe("detectAnomalies — determinism and safety", () => {
  it("never throws on a fully-default packet", () => {
    expect(() => detectAnomalies(emptyPacket(BASE_INIT))).not.toThrow();
  });

  it("the same packet always produces the same anomalies", () => {
    const p = turn2 as unknown as TurnEvidencePacket;
    expect(codesOf(p)).toEqual(codesOf(p));
  });
});

describe("#3963 — the LOTO clause is not an ungrounded unit claim", () => {
  // 25 of 40 turns in the 2026-09-22 sweep, and the photo benchmark's only
  // unit-bearing number, were "0 V" inside the energy-isolation clause that
  // MIRA_CORE REQUIRES in the same sentence as any instruction to touch wiring.
  it("exempts an all-zero magnitude", () => {
    for (const s of [
      "With the drive isolated, locked out and the DC bus verified at 0 V, measure the coil.",
      "Confirm the bus is at 0 V before touching the terminals.",
      "With power isolated, locked out and the line voltage verified at 0 V, listen for the chatter.",
    ]) {
      expect(ungroundedUnitClaim(s)).toBe(false);
    }
  });

  it("still flags a real rating claim, including one in the same answer as the clause", () => {
    expect(ungroundedUnitClaim("The operating range is 50 °C.")).toBe(true);
    expect(ungroundedUnitClaim("Its width is 2.5 in.")).toBe(true);
    // The exemption is per-match, not per-answer: a LOTO clause must not
    // launder a rating claim that appears beside it.
    expect(
      ungroundedUnitClaim("With the bus verified at 0 V, note the panel is rated 50 °C."),
    ).toBe(true);
  });
});

describe("#3962 — evidence in context that the answer never used", () => {
  it("flags chunks in context with zero citations shipped on an ANSWERED turn", () => {
    const p = emptyPacket(BASE_INIT);
    p.context.chunk_count = 6;
    p.answer_gate.invoked = true;
    p.answer_gate.decision = "answered";
    p.answer_gate.citations_shipped = 0;
    expect(codesOf(p)).toContain("DOCUMENTS_IN_CONTEXT_UNCITED");
  });

  it("does NOT flag an abstain — refusing on unsupportive chunks is correct", () => {
    const p = emptyPacket(BASE_INIT);
    p.context.chunk_count = 6;
    p.answer_gate.invoked = true;
    p.answer_gate.decision = "insufficient_evidence";
    p.answer_gate.citations_shipped = 0;
    expect(codesOf(p)).not.toContain("DOCUMENTS_IN_CONTEXT_UNCITED");
  });

  it("does NOT flag an answer that shipped a citation", () => {
    const p = emptyPacket(BASE_INIT);
    p.context.chunk_count = 6;
    p.answer_gate.invoked = true;
    p.answer_gate.decision = "answered";
    p.answer_gate.citations_shipped = 1;
    expect(codesOf(p)).not.toContain("DOCUMENTS_IN_CONTEXT_UNCITED");
  });

  it("does NOT flag a turn that retrieved nothing", () => {
    const p = emptyPacket(BASE_INIT);
    p.context.chunk_count = 0;
    p.answer_gate.invoked = true;
    p.answer_gate.decision = "answered";
    p.answer_gate.citations_shipped = 0;
    expect(codesOf(p)).not.toContain("DOCUMENTS_IN_CONTEXT_UNCITED");
  });

  it("surfaces an unverified visual mismatch, and only that verdict", () => {
    const p = emptyPacket(BASE_INIT);
    p.visual_evidence.observation_in_context = true;
    p.answer_gate.evidence_followed = {
      version: "1",
      verdict: "unverified_mismatch",
      subject_identifiers: 1,
      subject_identifiers_in_answer: 0,
      evidence_classes: ["bearing"],
      answer_classes: ["drive"],
      lead_classes: ["bearing"],
      lead_verdict: "unverified_mismatch",
    };
    expect(codesOf(p)).toContain("ANSWER_IGNORED_VISUAL_EVIDENCE");

    p.answer_gate.evidence_followed!.verdict = "consistent";
    expect(codesOf(p)).not.toContain("ANSWER_IGNORED_VISUAL_EVIDENCE");
    p.answer_gate.evidence_followed = null;
    expect(codesOf(p)).not.toContain("ANSWER_IGNORED_VISUAL_EVIDENCE");
  });
});
