/**
 * Answer Requirements Gate v1 — shadow verdict per answered turn.
 *
 * Seven requirements verify that a grounded answer meets its delivery contract:
 * follows evidence, right equipment, consistent with photos, no invented values,
 * uses relevant evidence, proper calibration, and ships citations. Each maps to
 * a JEV signal or deterministic check, and thresholds follow jev-candidates.ts
 * PROVISIONAL_THRESHOLDS (2026-09-23 hand-fitted baseline, not production).
 *
 * Rules: `.claude/rules/prove-the-test-fails.md` (mutation red/green with counts).
 * Constraint: ADR-0029 rule 9 (no self-promotion; this is SHADOW ONLY).
 */

import type { TurnEvidencePacket } from "./turn-evidence-packet";
import { setSpanAttrs } from "./tracing";
import { PROVISIONAL_THRESHOLDS } from "./jev-candidates";

export const ANSWER_REQUIREMENTS_VERSION = "answer-requirements-v1" as const;

/** Pipeline order for earliest stage to fix: identity < retrieval < vision < generation < citation. */
/** PROVISIONAL, uncalibrated (no adjudication yet) — R5 counts toward the verdict but its rate must be
 *  measured against human labels before anything reads it. Bump ANSWER_REQUIREMENTS_VERSION if it moves. */
export const IGNORED_EVIDENCE_PROVISIONAL = 0.5;

const STAGE_ORDER = ["identity", "retrieval", "vision", "generation", "citation"] as const;
type StageName = (typeof STAGE_ORDER)[number];

type RequirementStatus = "pass" | "fail" | "unjudged" | "not_applicable";

export type AnswerRequirementCheck = {
  id: string;
  status: RequirementStatus;
  signal?: string;
  value?: number | boolean;
  threshold?: number;
};

export type AnswerRequirementsVerdict = {
  version: typeof ANSWER_REQUIREMENTS_VERSION;
  verdict: "pass" | "fail" | "unjudged";
  failed: string[];
  unjudged: string[];
  not_applicable: string[];
  primary_stage: StageName | null;
  jev_failure_class: string | null;
  checks: AnswerRequirementCheck[];
};

/**
 * #4870 T-2 — R4 policy option, Mike's decision, shipped OFF. Mike's calibration fix 1 says a
 * number that appears verbatim in the evidence is supported. When ON: if the deterministic
 * check found at least one numeric claim in the answer (`answer_gate.numeric_claims`) and the
 * evidence the PROVIDER actually received supports ALL of them (`numeric_claims_unsupported`
 * = 0), and neither deterministic flag fired, the JEV `unsupported_numerics` signal ALONE does
 * not fail R4. "Received" is the route's contract for those counts (#4981, Codex r1 F1): each
 * chunk's model-visible text (first MODEL_VISIBLE_CHARS = manual-rag MAX_CONTENT_CHARS) plus the
 * photo observation text in the prompt — never raw chunk content past the cut, so text the
 * model never saw can never satisfy "all numbers found". This function only reads the counts. It never clears a deterministic flag, never applies when no claim was found, and
 * never applies to a packet from a build that does not record the counts. Flipping it changes
 * R4 verdicts: bump ANSWER_REQUIREMENTS_VERSION in the same change.
 */
export const R4_VERBATIM_OVERRIDE = false;

/** R4_NO_INVENTED_VALUES. `opts` exists so both policies are testable; the registry passes
 *  the shipped constant. */
export function r4NoInventedValues(
  p: TurnEvidencePacket,
  opts: { verbatimOverride?: boolean } = { verbatimOverride: R4_VERBATIM_OVERRIDE },
): { status: "pass" | "fail" | "unjudged"; signal?: string; value?: number | boolean; threshold?: number } {
  const jevSig = p.jev_decision?.signals?.unsupported_numerics;
  const detUngrounded = p.answer_gate.ungrounded_unit_claim ?? false;
  const detUnsupported = p.answer_gate.cited_values_unsupported ?? 0;

  const jevUnjudged = typeof jevSig !== "number";
  const detFail = detUngrounded || detUnsupported > 0;

  if (jevUnjudged && detFail) {
    return {
      status: "fail" as const,
      signal: "unsupported_numerics (det)",
      value: detUnsupported,
    };
  }
  if (jevUnjudged && !detFail) {
    return { status: "unjudged" as const };
  }

  // JEV is present
  const threshold = PROVISIONAL_THRESHOLDS.unsupported_numerics;
  const jevPass = (jevSig as number) < threshold;
  const claims = p.answer_gate.numeric_claims;
  const claimsUnsupported = p.answer_gate.numeric_claims_unsupported;
  if (
    opts.verbatimOverride === true &&
    !detFail &&
    !jevPass &&
    typeof claims === "number" &&
    claims >= 1 &&
    claimsUnsupported === 0
  ) {
    return { status: "pass" as const, signal: "numeric_claims_supported (det)", value: claims };
  }
  const pass = jevPass && !detFail;

  return {
    status: pass ? ("pass" as const) : ("fail" as const),
    signal: "unsupported_numerics",
    value: jevSig,
    threshold: detFail ? undefined : threshold,
  };
}

/**
 * Registry of all requirements, exported for test assertions.
 * Each requirement names its stage, precondition, and JEV/deterministic checks.
 */
export const ANSWER_REQUIREMENTS = [
  {
    id: "R1_GROUNDED",
    name: "Claims follow from the retrieved evidence",
    stage: "generation" as const,
    precondition: (p: TurnEvidencePacket) => p.context.chunk_count > 0,
    check: (p: TurnEvidencePacket) => {
      const sig = p.jev_decision?.signals?.follows_evidence;
      if (typeof sig !== "number") return { status: "unjudged" as const };
      const threshold = PROVISIONAL_THRESHOLDS.follows_evidence_floor;
      const pass = sig >= threshold;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "follows_evidence",
        value: sig,
        threshold,
      };
    },
  },
  {
    id: "R2_RIGHT_EQUIPMENT",
    name: "Doesn't lean on material about different equipment",
    stage: "retrieval" as const,
    precondition: (p: TurnEvidencePacket) => p.context.chunk_count > 0,
    check: (p: TurnEvidencePacket) => {
      const sig = p.jev_decision?.signals?.wrong_family_grounding;
      if (typeof sig !== "number") return { status: "unjudged" as const };
      const threshold = PROVISIONAL_THRESHOLDS.wrong_family_grounding;
      const pass = sig < threshold;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "wrong_family_grounding",
        value: sig,
        threshold,
      };
    },
  },
  {
    id: "R3_MATCHES_PHOTO",
    name: "Consistent with the photo observations",
    stage: "vision" as const,
    precondition: (p: TurnEvidencePacket) => p.context.visual_evidence_count > 0,
    check: (p: TurnEvidencePacket) => {
      const sig = p.jev_decision?.signals?.contradicts_observations;
      if (typeof sig !== "number") return { status: "unjudged" as const };
      const threshold = PROVISIONAL_THRESHOLDS.contradicts_observations;
      const pass = sig < threshold;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "contradicts_observations",
        value: sig,
        threshold,
      };
    },
  },
  {
    id: "R4_NO_INVENTED_VALUES",
    name: "No number/setting absent from the evidence",
    stage: "generation" as const,
    precondition: (_: TurnEvidencePacket) => true,
    check: (p: TurnEvidencePacket) => r4NoInventedValues(p),
  },
  {
    id: "R5_USES_RELEVANT_EVIDENCE",
    name: "Doesn't omit clearly relevant evidence it was given",
    stage: "generation" as const,
    precondition: (p: TurnEvidencePacket) => p.context.chunk_count > 0,
    note: "provisional_uncalibrated: true",
    check: (p: TurnEvidencePacket) => {
      const sig = p.jev_decision?.signals?.ignored_evidence;
      if (typeof sig !== "number") return { status: "unjudged" as const };
      const threshold = IGNORED_EVIDENCE_PROVISIONAL;
      const pass = sig < threshold;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "ignored_evidence",
        value: sig,
        threshold,
      };
    },
  },
  {
    id: "R6_CALIBRATED",
    name: "Not more certain than the material justifies",
    stage: "generation" as const,
    precondition: (p: TurnEvidencePacket) => p.context.chunk_count > 0,
    check: (p: TurnEvidencePacket) => {
      const sig = p.jev_decision?.signals?.over_specificity;
      if (typeof sig !== "number") return { status: "unjudged" as const };
      const threshold = PROVISIONAL_THRESHOLDS.over_specificity;
      const pass = sig < threshold;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "over_specificity",
        value: sig,
        threshold,
      };
    },
  },
  {
    id: "R7_CITED",
    name: "A grounded answer ships citations",
    stage: "citation" as const,
    precondition: (p: TurnEvidencePacket) => {
      const isAnswered = p.answer_gate.decision === "answered";
      return p.context.chunk_count > 0 && isAnswered;
    },
    check: (p: TurnEvidencePacket) => {
      const cited = p.answer_gate.citations_shipped;
      const pass = cited > 0;
      return {
        status: pass ? ("pass" as const) : ("fail" as const),
        signal: "citations_shipped",
        value: cited,
        threshold: 0,
      };
    },
  },
] as const;

/**
 * Pure. Evaluates all requirements against the packet.
 * Returns null when packet.jev_decision is absent (flag off, or pre-fabric packet).
 * Returns verdict with status "fail" if any applicable req fails, "unjudged" if
 * none fail but ≥1 applicable req is unjudged, "pass" otherwise.
 */
export function evaluateAnswerRequirements(
  packet: TurnEvidencePacket,
): AnswerRequirementsVerdict | null {
  // Flag off: no jev_decision means no requirements gate.
  if (!packet.jev_decision) return null;

  // If fabric skipped, verdict cannot be "pass" (rule 5).
  const skipped = packet.jev_decision.skipped_reason !== null;

  const checks: AnswerRequirementCheck[] = [];
  const failed: string[] = [];
  const unjudged: string[] = [];
  const not_applicable: string[] = [];
  const failedStages: StageName[] = [];

  for (const req of ANSWER_REQUIREMENTS) {
    const applicable = req.precondition(packet);
    const checkResult = req.check(packet);

    const status = applicable ? checkResult.status : "not_applicable";

    checks.push({
      id: req.id,
      ...checkResult,
      status,
    });

    if (status === "not_applicable") {
      not_applicable.push(req.id);
    } else if (status === "fail") {
      failed.push(req.id);
      failedStages.push(req.stage);
    } else if (status === "unjudged") {
      unjudged.push(req.id);
    }
  }

  // Determine overall verdict.
  let verdict: "pass" | "fail" | "unjudged";
  if (failed.length > 0) {
    verdict = "fail";
  } else if (unjudged.length > 0) {
    verdict = "unjudged";
  } else if (skipped) {
    // If fabric skipped and no reqs failed/unjudged, still can't pass.
    verdict = "unjudged";
  } else {
    verdict = "pass";
  }

  // Determine primary_stage: earliest stage among failures.
  let primary_stage: StageName | null = null;
  if (failedStages.length > 0) {
    const stages = new Set(failedStages);
    for (const stage of STAGE_ORDER) {
      if (stages.has(stage)) {
        primary_stage = stage;
        break;
      }
    }
  }

  const verd: AnswerRequirementsVerdict = {
    version: ANSWER_REQUIREMENTS_VERSION,
    verdict,
    failed,
    unjudged,
    not_applicable,
    primary_stage,
    jev_failure_class: packet.jev_decision.failure_class ?? null,
    checks,
  };

  // Emit OTel attrs.
  try {
    setSpanAttrs({
      "mira.answer_req.verdict": verdict,
      "mira.answer_req.failed": failed.join(","),
      "mira.answer_req.primary_stage": primary_stage ?? null,
    });
  } catch {
    /* telemetry never changes the outcome */
  }

  return verd;
}
