/**
 * Turn Evidence Packet — the durable, PII-free summary of one notebook
 * chat/look turn: which stages ran, what evidence reached the model, and how
 * the turn was decided.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §4. Persisted verbatim (as JSONB) on `decision_traces.evidence_packet`
 * (migration 090). Field names are snake_case to match the design's on-disk
 * shape exactly — this is the JSON that gets stored and read back, and the
 * hand-built fixtures under `__fixtures__/pixel-2026-09-22/` are this type,
 * so there is no camelCase<->snake_case translation layer anywhere.
 *
 * HARD RULE: this type carries ids, counts, booleans and timings ONLY. Never
 * message text, answer text, chunk text, prompts, or image bytes — those stay
 * on `decision_traces.user_question` / `.recommendation` under their existing
 * PII-sanitized contract (persist-usage.ts). `packet.test.ts` asserts no
 * content-shaped key ever appears on a serialized packet.
 *
 * Every field has an explicit default (false / 0 / null / []) so a partial
 * turn (the request errored before a later stage ran) still produces a valid,
 * fully-shaped packet — `emptyPacket` is that default, and `TurnRecorder`
 * (turn-recorder.ts) merges stage data into it as the turn progresses.
 */

export const TURN_EVIDENCE_PACKET_VERSION = "1" as const;

export type TurnKind = "chat" | "look";

/** Mirrors equipment-notebooks.ts IdentityStatus without importing that
 * module — this file stays self-contained (no lane-crossing dependency). */
export type IdentityState = "unknown" | "candidate" | "user_confirmed" | "verified" | string;

export type AnswerGateDecision = "answered" | "insufficient_evidence" | "blocked" | "error";

export type GenerationAttempt = {
  provider: string | null;
  model: string | null;
  outcome: "served" | "http_error" | "exception" | "client_stop";
  latency_ms: number | null;
  route_reason: string | null;
  response_id: string | null;
};

export type TurnEvidencePacketIds = {
  tenant_id: string;
  notebook_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  client_request_id: string | null;
  owner_user_id: string | null;
  file_ids: string[];
  visual_observation_ids: string[];
  asset_id: string | null;
  equipment_entity_id: string | null;
  asset_uns_path: string | null;
};

export type TurnEvidencePacketRequest = {
  /** Contract modes (2026-09-22) widen this: normal chat is `augmented`,
   *  explicit cite-or-refuse is `source_only`. Legacy values retained so old
   *  packets still parse. */
  mode: "general" | "grounded" | "augmented" | "source_only";
  message_chars: number;
  has_visual_evidence: boolean;
  has_machine_evidence: boolean;
  source_doc_count: number;
};

export type TurnEvidencePacketVision = {
  ran: boolean;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  observation_chars: number;
  hazard_count: number;
  ok: boolean;
};

export type TurnEvidencePacketVisualEvidence = {
  file_id: string | null;
  link_verified: boolean;
  observation_available: boolean;
  observation_in_context: boolean;
  prior_turn_observation_count: number;
  /** File ids of the earlier-turn photos whose observations were recalled. */
  prior_file_ids: string[];
};

export type TurnEvidencePacketIdentity = {
  ran: boolean;
  state: IdentityState;
  candidate_count: number;
  selected_entity_id: string | null;
  manufacturer_present: boolean;
  model_present: boolean;
  order_number_present: boolean;
  unresolved_reason: string | null;
};

export type TurnEvidencePacketRetrieval = {
  strategy: string | null;
  executed: boolean;
  candidate_count: number;
  returned_doc_ids: string[];
  oem_corpus_searched: boolean;
  /** Where the OEM manufacturer scope came from when oem_corpus_searched. */
  oem_manufacturer_source: "notebook" | "photo" | null;
  zero_result_reason: string | null;
  /** §3 span attr `mira.retrieval.prior_visual_observations_considered`. */
  prior_visual_observations_considered: number;
};

export type TurnEvidencePacketContext = {
  evidence_doc_ids: string[];
  chunk_count: number;
  visual_evidence_count: number;
  identity_included: boolean;
  history_turns: number;
  prompt_chars: number;
  /** Which system prompt the model received: general (no documents), grounded (documents), machine (machine packet). */
  system_prompt_kind: "general" | "grounded" | "machine" | "augmented" | "source_only" | null;
};

export type TurnEvidencePacketGeneration = {
  attempts: GenerationAttempt[];
  served_provider: string | null;
  served_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  has_image_input: boolean;
  has_observation_text: boolean;
};

export type TurnEvidencePacketAnswerGate = {
  invoked: boolean;
  decision: AnswerGateDecision;
  reason: string | null;
  answer_chars: number;
  refusal_phrase_matched: boolean;
  evidence_phrase_matched: boolean;
  safety_classification: "none" | "hazard_directive" | "hazard_pause" | "safety_stop";
  /** Which hazard banner rode above the answer ("confined space", "energized",
   *  …), or null. A safety PAUSE serves the answer and names the hazard above
   *  it; without this field a sweep of the recorder cannot tell a warned answer
   *  from an unwarned one. Never answer text — a class name from
   *  HAZARD_BANNERS. */
  hazard_banner?: string | null;
  evidence_sufficient: boolean;
  /** ungroundedUnitClaim(answerText) result (anomalies.ts) — the ONLY trace
   * of answer text this packet ever carries is this one boolean. */
  ungrounded_unit_claim: boolean;
  /** SHADOW (MIRA_JEV_SHADOW=1): Jev noul probability that the retrieved
   *  evidence suffices — recorded for comparison, never consulted by the gate.
   *  null when not run; `jev_skipped_reason` says why. */
  jev_sufficient: number | null;
  jev_skipped_reason: string | null;
  jev_latency_ms: number | null;
  /** Jev `usage.input_tokens` for the shadow call — the cost basis ($/M input; output is free). */
  jev_input_tokens: number | null;
};

export type TurnEvidencePacketPersistence = {
  turn_row_id: string | null;
  evidence_entries: number;
  outcome: "ok" | "failed" | "pending";
  error_code: string | null;
};

export type TurnEvidencePacketTimingsMs = {
  total: number | null;
  vision: number | null;
  identity: number | null;
  retrieval: number | null;
  context: number | null;
  generation_ttfb: number | null;
  generation: number | null;
  persist: number | null;
};

export type TurnEvidencePacketError = { stage: string; code: string };

export type TurnEvidencePacket = {
  v: typeof TURN_EVIDENCE_PACKET_VERSION;
  kind: TurnKind;
  trace_id: string | null;
  vision_trace_id: string | null;
  environment: string;
  git_sha: string;
  service_version: string;
  ids: TurnEvidencePacketIds;
  request: TurnEvidencePacketRequest;
  vision: TurnEvidencePacketVision;
  visual_evidence: TurnEvidencePacketVisualEvidence;
  identity: TurnEvidencePacketIdentity;
  retrieval: TurnEvidencePacketRetrieval;
  context: TurnEvidencePacketContext;
  generation: TurnEvidencePacketGeneration;
  answer_gate: TurnEvidencePacketAnswerGate;
  persistence: TurnEvidencePacketPersistence;
  timings_ms: TurnEvidencePacketTimingsMs;
  errors: TurnEvidencePacketError[];
};

/** What is known at request.receive, before any stage has run. */
export type PacketInit = {
  kind: TurnKind;
  trace_id?: string | null;
  vision_trace_id?: string | null;
  environment: string;
  git_sha: string;
  service_version: string;
  tenant_id: string;
  notebook_id?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  client_request_id?: string | null;
  owner_user_id?: string | null;
};

/**
 * The fully-shaped, all-defaults packet. Every stage the recorder never
 * reaches (an early error, a `kind:"look"` turn with no generation stage)
 * keeps its default rather than being absent — a diagnostics reader can
 * always destructure the whole shape without an undefined check.
 */
export function emptyPacket(init: PacketInit): TurnEvidencePacket {
  return {
    v: TURN_EVIDENCE_PACKET_VERSION,
    kind: init.kind,
    trace_id: init.trace_id ?? null,
    vision_trace_id: init.vision_trace_id ?? null,
    environment: init.environment,
    git_sha: init.git_sha,
    service_version: init.service_version,
    ids: {
      tenant_id: init.tenant_id,
      notebook_id: init.notebook_id ?? null,
      thread_id: init.thread_id ?? null,
      turn_id: init.turn_id ?? null,
      client_request_id: init.client_request_id ?? null,
      owner_user_id: init.owner_user_id ?? null,
      file_ids: [],
      visual_observation_ids: [],
      asset_id: null,
      equipment_entity_id: null,
      asset_uns_path: null,
    },
    request: {
      mode: "general",
      message_chars: 0,
      has_visual_evidence: false,
      has_machine_evidence: false,
      source_doc_count: 0,
    },
    vision: {
      ran: false,
      provider: null,
      model: null,
      latency_ms: null,
      observation_chars: 0,
      hazard_count: 0,
      ok: false,
    },
    visual_evidence: {
      file_id: null,
      link_verified: false,
      observation_available: false,
      observation_in_context: false,
      prior_turn_observation_count: 0,
      prior_file_ids: [],
    },
    identity: {
      ran: false,
      state: "unknown",
      candidate_count: 0,
      selected_entity_id: null,
      manufacturer_present: false,
      model_present: false,
      order_number_present: false,
      unresolved_reason: null,
    },
    retrieval: {
      strategy: null,
      executed: false,
      candidate_count: 0,
      returned_doc_ids: [],
      oem_corpus_searched: false,
      oem_manufacturer_source: null,
      zero_result_reason: null,
      prior_visual_observations_considered: 0,
    },
    context: {
      evidence_doc_ids: [],
      chunk_count: 0,
      visual_evidence_count: 0,
      identity_included: false,
      history_turns: 0,
      prompt_chars: 0,
      system_prompt_kind: null,
    },
    generation: {
      attempts: [],
      served_provider: null,
      served_model: null,
      input_tokens: null,
      output_tokens: null,
      has_image_input: false,
      has_observation_text: false,
    },
    answer_gate: {
      invoked: false,
      decision: "error",
      reason: null,
      answer_chars: 0,
      refusal_phrase_matched: false,
      evidence_phrase_matched: false,
      safety_classification: "none",
      evidence_sufficient: false,
      ungrounded_unit_claim: false,
      jev_sufficient: null,
      jev_skipped_reason: null,
      jev_latency_ms: null,
      jev_input_tokens: null,
    },
    persistence: {
      turn_row_id: null,
      evidence_entries: 0,
      outcome: "pending",
      error_code: null,
    },
    timings_ms: {
      total: null,
      vision: null,
      identity: null,
      retrieval: null,
      context: null,
      generation_ttfb: null,
      generation: null,
      persist: null,
    },
    errors: [],
  };
}

/**
 * Compact projection for a list/read surface. Takes the anomaly codes as a
 * plain `{code}[]` (not the `Anomaly` type from anomalies.ts) so this module
 * never imports anomalies.ts — anomalies.ts imports the packet TYPE from
 * here; a back-import would make the two files circular for no reason.
 */
export function packetSummary(
  p: TurnEvidencePacket,
  anomalies: { code: string }[] = [],
): {
  decision: AnswerGateDecision;
  reason: string | null;
  anomalyCodes: string[];
  hasVisualEvidence: boolean;
  evidenceDocCount: number;
  answerChars: number;
} {
  return {
    decision: p.answer_gate.decision,
    reason: p.answer_gate.reason,
    anomalyCodes: anomalies.map((a) => a.code),
    hasVisualEvidence: p.request.has_visual_evidence,
    evidenceDocCount: p.context.evidence_doc_ids.length,
    answerChars: p.answer_gate.answer_chars,
  };
}
