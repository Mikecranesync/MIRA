/**
 * Jev Decision Fabric — a continuous SHADOW judgment layer over finished turns.
 *
 * WHAT THIS IS NOT
 * It is not a safety control, not an auth control, not a lifecycle/accounting
 * control, not a privacy control, and not a release gate. Every one of those
 * stays deterministic and runs independently. Jev may only OBSERVE them: the
 * deterministic gate outcomes are handed to it as part of the state so a judge
 * can be scored AGAINST them, never substituted FOR them. Nothing in this file
 * is read by the answer path — `evaluateTurnDecision` is called after the
 * answer is committed, and its failure is a recorded null.
 *
 * WHY ONE REQUEST WITH MANY QUESTIONS
 * Measured on the live API 2026-09-23: 1 question = 312 input tokens,
 * 4 questions = 380. The state dominates; questions are nearly free. So the
 * whole 12-question set costs roughly one call, which is what makes running it
 * on EVERY captured turn affordable rather than a sampled luxury.
 *
 * WHY THESE QUESTIONS
 * Each one is a hypothesis about a real observed failure, not a guess:
 *   Q3 wrong_family      → #3966 (SIEMENS HMI panel answered from SINAMICS drive manuals)
 *   Q7 contradicts_obs   → #3962 (bearing question answered about the wrong subject)
 *   Q4/Q8 numerics       → #3963 (specificity beyond evidence)
 * The rest complete the picture so a single record can classify a turn rather
 * than only flag one known shape. Crucially NONE of them name an equipment
 * vocabulary: the whole point of the measurement in
 * docs/proofs/2026-09-23-3962-detector-comparison.md is that the deterministic
 * class-overlap rule scored 0/11 because it depends on a closed vocabulary,
 * while a semantic judge scored 11/11 with 0 false positives on the same input.
 *
 * PRIVACY — see docs/proofs/2026-09-23-jev-decision-privacy.md for the audited
 * payload. Summary: question, resolved identity, photo observations, evidence
 * excerpts, the delivered answer, and deterministic gate outcomes. No
 * credentials, no cookies, no tenant or user identifiers, no notebook names, no
 * unrelated history, no file bytes, no model chain-of-thought. All text is
 * length-capped and vendor-scrubbed (IP/MAC/serial shapes) by
 * `turn-decision-state.ts` before it reaches this module.
 */

import { jevDecisionEnabled } from "./config";
import { JEV_ENDPOINT, JEV_MODEL } from "./jev-shadow";
import { setSpanAttrs } from "./tracing";
import { renderDecisionState, type TurnDecisionState } from "./turn-decision-state";

/** Bump when a question's WORDING or the set's MEMBERSHIP changes. Scores from
 *  different versions are not comparable and must not be pooled. */
export const JEV_QUESTION_SET_VERSION = "decision-fabric-v1" as const;

const DEFAULT_TIMEOUT_MS = 4000;

type NoulQuestion = { type: "noul"; instructions: string };
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };

/**
 * The question set, verbatim as sent. Exported so a test asserts on the bytes
 * and the privacy note quotes rather than paraphrases it.
 *
 * Phrasing rule: every question is answerable from the state alone, describes
 * a property of the ANSWER relative to the EVIDENCE/OBSERVATIONS, and names no
 * manufacturer, model, or equipment category.
 */
export const JEV_DECISION_QUESTIONS = {
  // Q1 — the root question. Everything else refines it.
  follows_evidence: {
    type: "noul",
    instructions:
      "Do the factual claims in the answer follow from the retrieved evidence and the photo observations? " +
      "Answer no if the answer asserts specifics that the provided material does not support.",
  },
  // Q2 — is the evidence even about the same thing the technician is asking about?
  family_match: {
    type: "noul",
    instructions:
      "Is the retrieved evidence about the same kind of equipment as the subject of the technician's question? " +
      "Judge what the material is ABOUT, not whether words are shared.",
  },
  // Q3 — #3966. The dangerous case: confidently answering from a sibling product.
  wrong_family_grounding: {
    type: "noul",
    instructions:
      "Does the answer present information drawn from material about a DIFFERENT kind of equipment as if it applied to the equipment the technician asked about? " +
      "Answer yes only if the answer actually relies on that mismatched material.",
  },
  // Q4 — #3963's core shape, stated semantically rather than as a regex.
  unsupported_numerics: {
    type: "noul",
    instructions:
      "Does the answer state a specific numeric value, setting, threshold, or parameter that does not appear in the evidence or observations?",
  },
  // Q5 — did it reach for the best thing it had?
  used_strongest_evidence: {
    type: "noul",
    instructions:
      "Among the evidence provided, did the answer rely on the item most relevant to the question?",
  },
  // Q6 — the inverse of Q5: relevant material present and unused.
  ignored_evidence: {
    type: "noul",
    instructions:
      "Was there evidence provided that was clearly relevant to the question but is absent from the answer?",
  },
  // Q7 — #3962. The observation says one thing, the answer talks about another.
  contradicts_observations: {
    type: "noul",
    instructions:
      "Does the answer contradict, or talk about a different subject than, what the photo observations describe?",
  },
  // Q8 — confidence calibration, independent of whether a number appears.
  over_specificity: {
    type: "noul",
    instructions:
      "Is the answer more precise or more certain than the underlying material justifies?",
  },
  // Q9 — typed classification. Measured on the live API: on the #3966 state this
  // returned retrieval_mismatch at 0.59 with no vocabulary hint.
  failure_class: {
    type: "choice",
    instructions:
      "If this answer is unsatisfactory, what is the earliest point at which it went wrong?",
    criteria: {
      none: "The answer is satisfactory given what was available.",
      identity: "The system misidentified what equipment is being asked about.",
      retrieval_mismatch: "The retrieved material is about the wrong equipment or the wrong topic.",
      missing_evidence: "The right material was simply not available to answer this.",
      interpretation: "The material was right but the answer drew the wrong conclusion from it.",
      overreach: "The answer went beyond what the material supports.",
      unresponsive: "The answer does not address what was actually asked.",
    },
  },
  // Q10 — triage: is this worth freezing as a regression fixture?
  regression_candidate: {
    type: "noul",
    instructions:
      "Is this turn a clear enough example of incorrect behaviour that it should be kept as a permanent test case?",
  },
  // Q11 — triage: does a human need to look?
  needs_human_review: {
    type: "noul",
    instructions:
      "Would a maintenance expert need to review this answer before a technician acted on it?",
  },
  // Q12 — responsiveness, independent of correctness.
  answered_the_request: {
    type: "noul",
    instructions: "Does the answer address what the technician actually asked for?",
  },
} as const satisfies Record<string, NoulQuestion | ChoiceQuestion>;

export type JevQuestionKey = keyof typeof JEV_DECISION_QUESTIONS;

export type JevDecisionRecord = {
  question_set_version: typeof JEV_QUESTION_SET_VERSION;
  state_version: string | null;
  model: string | null;
  /** noul question key → probability in [0,1]; absent when the call did not run. */
  signals: Partial<Record<JevQuestionKey, number>>;
  /** Q9's typed answer plus its full distribution. */
  failure_class: string | null;
  failure_class_confidence: number | null;
  failure_class_probabilities: Record<string, number> | null;
  latency_ms: number | null;
  input_tokens: number | null;
  /** disabled | no_key | timeout | http_<status> | malformed | error — null when it ran. */
  skipped_reason: string | null;
};

const EMPTY: Omit<JevDecisionRecord, "skipped_reason"> = {
  question_set_version: JEV_QUESTION_SET_VERSION,
  state_version: null,
  model: null,
  signals: {},
  failure_class: null,
  failure_class_confidence: null,
  failure_class_probabilities: null,
  latency_ms: null,
  input_tokens: null,
};

/** Pure: the exact request body. */
export function buildDecisionRequest(state: TurnDecisionState) {
  return {
    model: JEV_MODEL,
    state: renderDecisionState(state),
    questions: JEV_DECISION_QUESTIONS as unknown as Record<string, NoulQuestion | ChoiceQuestion>,
  };
}

/**
 * Fail-open, non-blocking-by-contract shadow evaluation.
 *
 * Callers MUST invoke this only after the answer has been committed to the
 * client, and MUST NOT await it in a path that can delay delivery. It never
 * throws: every failure mode becomes a `skipped_reason` on the record, so an
 * outage is visible in the data rather than silent.
 */
export async function evaluateTurnDecision(
  state: TurnDecisionState,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<JevDecisionRecord> {
  const base: JevDecisionRecord = { ...EMPTY, state_version: state.v, skipped_reason: null };
  if (!jevDecisionEnabled()) return { ...base, skipped_reason: "disabled" };
  const apiKey = opts.apiKey ?? process.env.JEV_API_KEY;
  if (!apiKey) return { ...base, skipped_reason: "no_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await (opts.fetchImpl ?? fetch)(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildDecisionRequest(state)),
      signal: controller.signal,
    });
    const latency = Date.now() - started;
    if (!res.ok) return emit({ ...base, skipped_reason: `http_${res.status}`, latency_ms: latency });
    const json = (await res.json()) as {
      model?: string;
      answers?: Record<string, { noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
      usage?: { input_tokens?: number };
    };
    const answers = json.answers ?? {};
    const signals: Partial<Record<JevQuestionKey, number>> = {};
    for (const key of Object.keys(JEV_DECISION_QUESTIONS) as JevQuestionKey[]) {
      if (JEV_DECISION_QUESTIONS[key].type !== "noul") continue;
      const n = answers[key]?.noul;
      if (typeof n === "number") signals[key] = n;
    }
    const fc = answers.failure_class;
    // A response carrying none of the twelve answers is malformed, not a zero score.
    if (Object.keys(signals).length === 0 && !fc?.choice) {
      return emit({ ...base, skipped_reason: "malformed", latency_ms: latency });
    }
    return emit({
      ...base,
      model: json.model ?? null,
      signals,
      failure_class: typeof fc?.choice === "string" ? fc.choice : null,
      failure_class_confidence: typeof fc?.confidence === "number" ? fc.confidence : null,
      failure_class_probabilities: fc?.probabilities ?? null,
      latency_ms: latency,
      input_tokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : null,
    });
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    return emit({ ...base, skipped_reason: aborted ? "timeout" : "error", latency_ms: Date.now() - started });
  } finally {
    clearTimeout(timer);
  }
}

function emit(r: JevDecisionRecord): JevDecisionRecord {
  try {
    const attrs: Record<string, string | number | boolean | null> = {
      "mira.jev.question_set_version": r.question_set_version,
      "mira.jev.model": r.model,
      "mira.jev.latency_ms": r.latency_ms,
      "mira.jev.skipped_reason": r.skipped_reason,
      "mira.jev.failure_class": r.failure_class,
      "mira.jev.failure_class_confidence": r.failure_class_confidence,
    };
    for (const [k, v] of Object.entries(r.signals)) attrs[`mira.jev.${k}`] = v;
    setSpanAttrs(attrs);
  } catch {
    /* telemetry never changes the outcome */
  }
  return r;
}
