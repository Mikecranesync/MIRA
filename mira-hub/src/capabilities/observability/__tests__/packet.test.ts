/**
 * Turn Evidence Packet — defaults + the content ban.
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/packet.test.ts
 */
import { describe, expect, it } from "vitest";
import { emptyPacket, packetSummary, TURN_EVIDENCE_PACKET_VERSION } from "../turn-evidence-packet";

const BASE_INIT = {
  kind: "chat" as const,
  environment: "staging",
  git_sha: "dd41c7f8e3bac27fc0b8f2bcdbbbc4ebdb5bbf2c",
  service_version: "v3.351.7",
  tenant_id: "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe",
  notebook_id: "93d8c68e-d252-451d-8b52-e0a830543437",
};

describe("emptyPacket — defaults", () => {
  it("stamps the version and kind from init", () => {
    const p = emptyPacket(BASE_INIT);
    expect(p.v).toBe(TURN_EVIDENCE_PACKET_VERSION);
    // Literal on purpose: a version bump should be a DECISION, so it has to
    // break this line. "2" adds answer_gate.citations_shipped and
    // answer_gate.evidence_followed (#3962).
    expect(p.v).toBe("2");
    expect(p.kind).toBe("chat");
  });

  it("every boolean field defaults to false", () => {
    const p = emptyPacket(BASE_INIT);
    expect(p.request.has_visual_evidence).toBe(false);
    expect(p.request.has_machine_evidence).toBe(false);
    expect(p.vision.ran).toBe(false);
    expect(p.vision.ok).toBe(false);
    expect(p.visual_evidence.link_verified).toBe(false);
    expect(p.visual_evidence.observation_available).toBe(false);
    expect(p.visual_evidence.observation_in_context).toBe(false);
    expect(p.identity.ran).toBe(false);
    expect(p.identity.manufacturer_present).toBe(false);
    expect(p.identity.model_present).toBe(false);
    expect(p.identity.order_number_present).toBe(false);
    expect(p.retrieval.executed).toBe(false);
    expect(p.retrieval.oem_corpus_searched).toBe(false);
    expect(p.context.identity_included).toBe(false);
    expect(p.generation.has_image_input).toBe(false);
    expect(p.generation.has_observation_text).toBe(false);
    expect(p.answer_gate.invoked).toBe(false);
    expect(p.answer_gate.refusal_phrase_matched).toBe(false);
    expect(p.answer_gate.evidence_phrase_matched).toBe(false);
    expect(p.answer_gate.evidence_sufficient).toBe(false);
    expect(p.answer_gate.ungrounded_unit_claim).toBe(false);
  });

  it("every count field defaults to 0", () => {
    const p = emptyPacket(BASE_INIT);
    expect(p.request.message_chars).toBe(0);
    expect(p.request.source_doc_count).toBe(0);
    expect(p.vision.observation_chars).toBe(0);
    expect(p.vision.hazard_count).toBe(0);
    expect(p.visual_evidence.prior_turn_observation_count).toBe(0);
    expect(p.identity.candidate_count).toBe(0);
    expect(p.retrieval.candidate_count).toBe(0);
    expect(p.retrieval.prior_visual_observations_considered).toBe(0);
    expect(p.context.chunk_count).toBe(0);
    expect(p.context.visual_evidence_count).toBe(0);
    expect(p.context.history_turns).toBe(0);
    expect(p.context.prompt_chars).toBe(0);
    expect(p.answer_gate.answer_chars).toBe(0);
    expect(p.persistence.evidence_entries).toBe(0);
  });

  it("every nullable field defaults to null, never undefined", () => {
    const p = emptyPacket(BASE_INIT);
    expect(p.trace_id).toBeNull();
    expect(p.vision_trace_id).toBeNull();
    expect(p.ids.thread_id).toBeNull();
    expect(p.ids.turn_id).toBeNull();
    expect(p.ids.client_request_id).toBeNull();
    expect(p.ids.owner_user_id).toBeNull();
    expect(p.ids.asset_id).toBeNull();
    expect(p.vision.provider).toBeNull();
    expect(p.vision.model).toBeNull();
    expect(p.vision.latency_ms).toBeNull();
    expect(p.identity.selected_entity_id).toBeNull();
    expect(p.identity.unresolved_reason).toBeNull();
    expect(p.retrieval.strategy).toBeNull();
    expect(p.retrieval.zero_result_reason).toBeNull();
    expect(p.answer_gate.reason).toBeNull();
    expect(p.persistence.turn_row_id).toBeNull();
    expect(p.persistence.error_code).toBeNull();
    for (const k of Object.keys(p.timings_ms) as (keyof typeof p.timings_ms)[]) {
      expect(p.timings_ms[k]).toBeNull();
    }
  });

  it("every array field defaults to an empty array, never absent", () => {
    const p = emptyPacket(BASE_INIT);
    expect(p.ids.file_ids).toEqual([]);
    expect(p.ids.visual_observation_ids).toEqual([]);
    expect(p.retrieval.returned_doc_ids).toEqual([]);
    expect(p.context.evidence_doc_ids).toEqual([]);
    expect(p.generation.attempts).toEqual([]);
    expect(p.errors).toEqual([]);
  });

  it("carries ids passed in init and defaults the rest", () => {
    const p = emptyPacket({
      ...BASE_INIT,
      trace_id: "abc123",
      thread_id: "thrd_1",
      turn_id: "11111111-1111-1111-1111-111111111111",
      client_request_id: "cr-1",
      owner_user_id: "u-1",
    });
    expect(p.trace_id).toBe("abc123");
    expect(p.ids.tenant_id).toBe(BASE_INIT.tenant_id);
    expect(p.ids.notebook_id).toBe(BASE_INIT.notebook_id);
    expect(p.ids.thread_id).toBe("thrd_1");
    expect(p.ids.turn_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(p.ids.client_request_id).toBe("cr-1");
    expect(p.ids.owner_user_id).toBe("u-1");
  });
});

describe("packetSummary", () => {
  it("projects decision, reason and anomaly codes without leaking the packet", () => {
    const p = emptyPacket(BASE_INIT);
    p.answer_gate.decision = "insufficient_evidence";
    p.answer_gate.reason = "gate_g_no_evidence";
    // packetSummary only needs `.code`; a real caller passes the `Anomaly[]`
    // detectAnomalies returns (extra `stage`/`detail` fields and all) — a
    // variable, not an inline literal, so TS excess-property checking (which
    // only fires on object literals) doesn't reject the wider shape here.
    const anomalies: { code: string; stage: string; detail: Record<string, unknown> }[] = [
      { code: "VISUAL_EVIDENCE_DROPPED", stage: "context", detail: {} },
    ];
    const summary = packetSummary(p, anomalies);
    expect(summary).toEqual({
      decision: "insufficient_evidence",
      reason: "gate_g_no_evidence",
      anomalyCodes: ["VISUAL_EVIDENCE_DROPPED"],
      hasVisualEvidence: false,
      evidenceDocCount: 0,
      answerChars: 0,
    });
  });

  it("defaults anomalyCodes to an empty array when none are passed", () => {
    const p = emptyPacket(BASE_INIT);
    expect(packetSummary(p).anomalyCodes).toEqual([]);
  });
});

describe("packet — the content ban", () => {
  // Checked as an exact JSON KEY (`"key":`), not a bare substring: the packet
  // legitimately has `request.message_chars`, which contains the substring
  // "message" without being the forbidden `message` key. `"message":` (quote,
  // name, quote, colon) only matches an actual field literally named that.
  const FORBIDDEN_KEYS = ["message", "answerText", "question", "prompt", "cookie", "authorization"];

  it("a fresh packet never serializes a content-shaped key", () => {
    const p = emptyPacket(BASE_INIT);
    const json = JSON.stringify(p).toLowerCase();
    for (const key of FORBIDDEN_KEYS) {
      expect(json).not.toContain(`"${key.toLowerCase()}":`);
    }
  });

  it("a fully-populated packet still never serializes a content-shaped key", () => {
    const p = emptyPacket(BASE_INIT);
    p.ids.file_ids = ["f1", "f2"];
    p.request.has_visual_evidence = true;
    p.vision.observation_chars = 500;
    p.identity.state = "candidate";
    p.retrieval.strategy = "notebook_sources_bm25";
    p.context.evidence_doc_ids = ["doc1"];
    p.generation.attempts.push({
      provider: "Groq",
      model: "openai/gpt-oss-120b",
      outcome: "served",
      latency_ms: 1200,
      route_reason: "primary",
      response_id: "resp-1",
    });
    p.answer_gate.decision = "answered";
    p.answer_gate.ungrounded_unit_claim = true;
    p.errors.push({ stage: "generation", code: "timeout" });

    const json = JSON.stringify(p).toLowerCase();
    for (const key of FORBIDDEN_KEYS) {
      expect(json).not.toContain(`"${key.toLowerCase()}":`);
    }
  });
});
