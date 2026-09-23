/**
 * Deterministic anomaly checks over a Turn Evidence Packet.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §5. Pure functions over the packet only — no I/O, no clock, no randomness —
 * so the same packet always produces the same anomalies (recorder.test.ts and
 * the fixture table in anomalies.test.ts both depend on that determinism).
 *
 * These exist so Mike can open one Turn Evidence Packet and see WHY a bad
 * answer happened (evidence gathered but dropped before generation, an
 * equipment-specific answer with zero evidence attached, staging traffic
 * silently reaching a production destination) without re-deriving it by eye
 * from the raw packet every time.
 */
import type { TurnEvidencePacket } from "./turn-evidence-packet";

export type AnomalyCode =
  | "PHOTO_WITH_NO_OBSERVATIONS"
  | "VISUAL_EVIDENCE_DROPPED"
  | "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE"
  | "IDENTITY_PIPELINE_DROPPED"
  | "STAGING_TO_PROD_ROUTE"
  | "GENERIC_ANSWER_UNGROUNDED_CLAIM";

export type Anomaly = {
  code: AnomalyCode;
  stage: string;
  detail: Record<string, string | number | boolean | null>;
};

export type DetectAnomaliesOptions = {
  /**
   * Env vars (or resolved destination hosts) that resolved to a known
   * production host, computed once at SDK start and passed in — never
   * re-derived per packet. Empty/omitted = "nothing routed to prod".
   */
  productionRouteVars?: string[];
};

/**
 * The one unit-claim regex the design specifies. A digit (optionally with a
 * decimal fraction), optional whitespace, then a bounded unit token. Matches
 * "2.5 in" and "60 °C"; does NOT match "24 VDC" (no word boundary between
 * "V" and the following "DC") — that's intentional, not a bug: "VDC" is not
 * the unit "V".
 */
const UNGROUNDED_UNIT_CLAIM_RE = /\d+(\.\d+)?\s*(in|mm|cm|°C|V|A)\b/;

/**
 * Evaluated by the route on the raw answer text; only the boolean result is
 * ever stored on the packet (`answer_gate.ungrounded_unit_claim`). This
 * function itself is pure text -> boolean and keeps no state.
 */
export function ungroundedUnitClaim(answerText: string): boolean {
  for (const m of answerText.matchAll(UNGROUNDED_UNIT_CLAIM_GLOBAL)) {
    if (!isZeroMagnitude(m[0])) return true;
  }
  return false;
}

/** Global twin of the regex above, so every match can be judged rather than
 *  the first one deciding the whole answer. */
const UNGROUNDED_UNIT_CLAIM_GLOBAL = new RegExp(UNGROUNDED_UNIT_CLAIM_RE.source, "g");

/**
 * "verified at 0 V", "confirm the bus is at 0 V" — an ENERGY-ISOLATION
 * VERIFICATION, which MIRA_CORE requires in the same sentence as any
 * instruction to touch wiring. Zero is a statement that something is DEAD; it
 * is never a rating claim about the machine.
 *
 * Issue #3963: this detector fired on 25 of 40 turns in the 2026-09-22 sweep
 * and on a photo-benchmark answer whose only unit-bearing number was `0 V`.
 * The identical false positive was fixed in the ANSWER GATE by `a0318b21b`
 * (`allZeroMagnitude` in answer-validation.ts); the anomaly detector was not
 * touched, so the noise survived in telemetry. Same rule, same reasoning.
 *
 * This exempts NOTHING unsafe and nothing unsupported: a non-zero rating still
 * flags, and the gate — not this counter — is what actually withholds a
 * fabricated claim.
 */
function isZeroMagnitude(match: string): boolean {
  const num = match.match(/\d+(\.\d+)?/)?.[0];
  return num !== undefined && Number(num) === 0;
}

/**
 * Pure, deterministic anomaly detection over one packet. Never throws —
 * every predicate reads only fields `emptyPacket` already defaults, so a
 * partially-filled packet just fails every predicate rather than crashing.
 */
export function detectAnomalies(
  p: TurnEvidencePacket,
  opts?: DetectAnomaliesOptions,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // PHOTO_WITH_NO_OBSERVATIONS — a photo reached this turn (look or a chat
  // carrying visual evidence) but vision produced no observation text.
  const lookPhotoNoObservation =
    p.ids.file_ids.length > 0 && p.vision.ran && p.vision.observation_chars === 0;
  const chatPhotoNoObservation =
    p.request.has_visual_evidence && !p.visual_evidence.observation_available;
  if (lookPhotoNoObservation || chatPhotoNoObservation) {
    anomalies.push({
      code: "PHOTO_WITH_NO_OBSERVATIONS",
      stage: "vision",
      detail: {
        kind: p.kind,
        file_count: p.ids.file_ids.length,
        vision_ran: p.vision.ran,
        observation_chars: p.vision.observation_chars,
        has_visual_evidence: p.request.has_visual_evidence,
        observation_available: p.visual_evidence.observation_available,
      },
    });
  }

  // VISUAL_EVIDENCE_DROPPED — an observation exists (this turn's or a prior
  // turn's) but none of it reached context assembly.
  if (
    (p.visual_evidence.observation_available || p.visual_evidence.prior_turn_observation_count > 0) &&
    p.context.visual_evidence_count === 0
  ) {
    anomalies.push({
      code: "VISUAL_EVIDENCE_DROPPED",
      stage: "context",
      detail: {
        observation_available: p.visual_evidence.observation_available,
        prior_turn_observation_count: p.visual_evidence.prior_turn_observation_count,
        context_visual_evidence_count: p.context.visual_evidence_count,
      },
    });
  }

  // EQUIPMENT_ANSWER_WITH_NO_EVIDENCE — the turn looks equipment-specific
  // (identity resolved, a photo/machine snapshot was attached, OR earlier
  // turns in this thread already carried photo observations — a text-only
  // "can you find the manual for this screen" follow-up is about the same
  // machine) and MIRA answered, but neither a doc chunk nor a visual
  // observation backs it.
  if (
    (p.identity.state !== "unknown" ||
      p.request.has_visual_evidence ||
      p.request.has_machine_evidence ||
      p.visual_evidence.prior_turn_observation_count > 0) &&
    p.answer_gate.decision === "answered" &&
    p.context.evidence_doc_ids.length === 0 &&
    p.context.visual_evidence_count === 0
  ) {
    anomalies.push({
      code: "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE",
      stage: "answer_gate",
      detail: {
        identity_state: p.identity.state,
        has_visual_evidence: p.request.has_visual_evidence,
        has_machine_evidence: p.request.has_machine_evidence,
        prior_turn_observation_count: p.visual_evidence.prior_turn_observation_count,
        evidence_doc_count: p.context.evidence_doc_ids.length,
        context_visual_evidence_count: p.context.visual_evidence_count,
      },
    });
  }

  // IDENTITY_PIPELINE_DROPPED — identity had signal to work with (an
  // observation, or candidates) but never resolved AND never recorded why.
  if (
    p.identity.ran &&
    (p.visual_evidence.observation_available || p.identity.candidate_count > 0) &&
    p.identity.state === "unknown" &&
    !p.identity.unresolved_reason
  ) {
    anomalies.push({
      code: "IDENTITY_PIPELINE_DROPPED",
      stage: "identity",
      detail: {
        observation_available: p.visual_evidence.observation_available,
        candidate_count: p.identity.candidate_count,
        state: p.identity.state,
        unresolved_reason: p.identity.unresolved_reason,
      },
    });
  }

  // STAGING_TO_PROD_ROUTE — staging traffic resolved to a production
  // destination. The set of offending vars/hosts is computed once at SDK
  // start (design §5) and passed in; this predicate only checks it's non-empty.
  const productionRouteVars = opts?.productionRouteVars ?? [];
  if (p.environment === "staging" && productionRouteVars.length > 0) {
    anomalies.push({
      code: "STAGING_TO_PROD_ROUTE",
      stage: "config",
      detail: {
        environment: p.environment,
        production_route_vars: productionRouteVars.join(","),
        count: productionRouteVars.length,
      },
    });
  }

  // GENERIC_ANSWER_UNGROUNDED_CLAIM — MIRA answered with a specific-sounding
  // numeric/unit claim while retrieval never ran and no image reached
  // generation — i.e. nothing grounds the number it just stated.
  if (
    p.answer_gate.decision === "answered" &&
    p.retrieval.executed === false &&
    p.generation.has_image_input === false &&
    p.answer_gate.ungrounded_unit_claim === true
  ) {
    anomalies.push({
      code: "GENERIC_ANSWER_UNGROUNDED_CLAIM",
      stage: "answer_gate",
      detail: {
        retrieval_executed: p.retrieval.executed,
        has_image_input: p.generation.has_image_input,
        ungrounded_unit_claim: p.answer_gate.ungrounded_unit_claim,
      },
    });
  }

  return anomalies;
}
