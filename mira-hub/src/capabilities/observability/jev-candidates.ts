/**
 * Jev signals → anomaly CANDIDATES → replay fixtures.
 *
 * The stage between "a judge scored a turn" and "a regression test exists". It
 * is deliberately three separate things, because collapsing them is how a model
 * ends up silently deciding what MIRA's test suite asserts:
 *
 *   candidate   — this turn looks wrong, from signals alone. Cheap, noisy, and
 *                 produced automatically.
 *   confirmed   — a human agreed. NOT produced here, and there is no code path
 *                 that sets it (materialized-evidence rule 9).
 *   fixture     — a frozen replay case. Built only from a CONFIRMED label.
 *
 * WHY THE THRESHOLDS ARE ARGUMENTS AND NOT CONSTANTS
 * The goal is explicit that production thresholds are not to be chosen yet. So
 * the defaults below are marked PROVISIONAL, were fitted on a handful of states,
 * and exist only so the shadow pipeline produces *something* to measure. They
 * carry no authority. `CANDIDATE_RULES_VERSION` must be bumped when they move,
 * because candidate counts across versions are not comparable.
 */
import type { JevDecisionRecord } from "./jev-decision";

export const CANDIDATE_RULES_VERSION = "provisional-v1" as const;

/**
 * PROVISIONAL. Fitted on four hand-built states (2026-09-23) plus the eleven
 * #3962 divergences; NOT calibrated on fresh traffic, NOT a production setting.
 * The separation observed on those states was wide — divergent turns scored
 * wrong_family 0.92 / contradicts 0.91 against sound turns at 0.03 / 0.07 — so
 * a midpoint is defensible as a starting point and indefensible as a decision.
 */
export const PROVISIONAL_THRESHOLDS = {
  wrong_family_grounding: 0.5,
  contradicts_observations: 0.5,
  unsupported_numerics: 0.5,
  follows_evidence_floor: 0.5,
  over_specificity: 0.7,
  answered_the_request_floor: 0.3,
} as const;

export type JevCandidate = {
  code: string;
  /** The signal that fired and its value — so a candidate is auditable. */
  signal: string;
  value: number;
  threshold: number;
  rules_version: typeof CANDIDATE_RULES_VERSION;
};

/**
 * Pure. Returns every candidate a record supports — never a verdict, never a
 * single "the" failure. A turn can be several kinds of wrong at once and
 * flattening that early throws away the thing a human needs to judge it.
 *
 * Returns [] for a record that did not run: a skipped call is an absence of
 * evidence, and must never read as an absence of problems.
 */
export function jevCandidates(
  rec: JevDecisionRecord | null | undefined,
  opts: {
    thresholds?: Partial<Record<keyof typeof PROVISIONAL_THRESHOLDS, number>>;
    /**
     * Was anything actually retrieved for this turn? REQUIRED for the
     * evidence-relative rules, and the reason is a measured one — see the
     * EVIDENCE PRECONDITION note below. Defaults to `true` only so existing
     * callers keep compiling; a caller that knows should always pass it.
     */
    evidencePresent?: boolean;
  } = {},
): JevCandidate[] {
  if (!rec || rec.skipped_reason) return [];
  const t = { ...PROVISIONAL_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const evidencePresent = opts.evidencePresent ?? true;
  const s = rec.signals;
  const out: JevCandidate[] = [];
  const over = (code: string, key: keyof typeof s, limit: number) => {
    const v = s[key];
    if (typeof v === "number" && v >= limit) {
      out.push({ code, signal: key, value: v, threshold: limit, rules_version: CANDIDATE_RULES_VERSION });
    }
  };
  const under = (code: string, key: keyof typeof s, floor: number) => {
    const v = s[key];
    if (typeof v === "number" && v <= floor) {
      out.push({ code, signal: key, value: v, threshold: floor, rules_version: CANDIDATE_RULES_VERSION });
    }
  };
  // #3966 — the answer leaned on material about a different product.
  over("JEV_WRONG_FAMILY_GROUNDING", "wrong_family_grounding", t.wrong_family_grounding);
  // #3962 — the answer left the subject the photo established.
  over("JEV_CONTRADICTS_OBSERVATIONS", "contradicts_observations", t.contradicts_observations);
  // #3963 — a specific setting with nothing behind it.
  over("JEV_UNSUPPORTED_NUMERIC", "unsupported_numerics", t.unsupported_numerics);
  over("JEV_OVER_SPECIFIC", "over_specificity", t.over_specificity);
  // EVIDENCE PRECONDITION — measured on live staging traffic, 2026-09-23.
  // `follows_evidence` asks "do the claims follow from the retrieved evidence".
  // When NOTHING was retrieved that question is vacuous, and the judge answers
  // it low because it is honestly unsupported — not because the answer is bad.
  // On the first live run this rule fired on SIX OF SEVEN turns, all of them
  // `citations_shipped: 0`, including three turns whose answers were correct
  // and appropriately hedged. An 86% false-positive rate, from a rule that
  // looked clean on ten constructed states where evidence was always present
  // or the turn was an explicit refusal.
  //
  // So the evidence-relative questions are gated on evidence actually existing.
  // A turn with no evidence is not thereby a good turn — it is a turn this
  // particular question cannot speak to, and the honest handling is silence
  // rather than a confident flag.
  if (evidencePresent) {
    under("JEV_NOT_FOLLOWING_EVIDENCE", "follows_evidence", t.follows_evidence_floor);
  }
  // DELIBERATELY NOT A RULE: `answered_the_request`.
  // Measured 0.70 accuracy — the worst of the eleven — and the reason is
  // structural, not statistical: a CORRECT REFUSAL does not answer the request.
  // "I do not have the torque spec for this panel, check the manual" is the
  // right answer and scores low on responsiveness, so the question conflates
  // "MIRA failed" with "MIRA correctly declined". At the provisional floor it
  // caught 1 of 4 real divergences while being wrong about refusals — a rule
  // that would teach the corpus to punish honesty. The signal is still
  // RECORDED on the packet; it just does not generate candidates until the
  // question is re-worded (which is a question-set-version change).
  // Measurement: docs/proofs/2026-09-23-jev-decision-calibration.md.
  return out;
}

/**
 * A replay fixture, frozen from a turn a human CONFIRMED was wrong.
 *
 * `confirmedBy` is required and has no default. That is the whole safeguard:
 * there is no way to reach this function from the judge's output alone, so the
 * regression corpus cannot grow without a person's name on each addition.
 */
export type ReplayFixture = {
  id: string;
  issue: string | null;
  confirmed_by: string;
  confirmed_at: string;
  /** What the technician sent. */
  question: string;
  /** What a correct answer must and must not do — written by the human. */
  expectation: string;
  /** The judge's reading at capture time, kept as context, never as the assertion. */
  jev_at_capture: JevDecisionRecord;
  candidates_at_capture: JevCandidate[];
  trace_id: string | null;
  captured_sha: string | null;
};

export function buildReplayFixture(input: {
  id: string;
  issue?: string | null;
  confirmedBy: string;
  expectation: string;
  question: string;
  jev: JevDecisionRecord;
  traceId?: string | null;
  capturedSha?: string | null;
  evidencePresent?: boolean;
  now?: () => Date;
}): ReplayFixture {
  if (!input.confirmedBy.trim()) {
    // Fail loudly rather than mint an unattributed fixture. A regression case
    // nobody signed is a regression case nobody can overturn.
    throw new Error("a replay fixture requires a human confirmer");
  }
  if (!input.expectation.trim()) {
    throw new Error("a replay fixture requires a human-written expectation");
  }
  return {
    id: input.id,
    issue: input.issue ?? null,
    confirmed_by: input.confirmedBy.trim(),
    confirmed_at: (input.now ?? (() => new Date()))().toISOString(),
    question: input.question,
    expectation: input.expectation.trim(),
    jev_at_capture: input.jev,
    candidates_at_capture: jevCandidates(input.jev, { evidencePresent: input.evidencePresent ?? true }),
    trace_id: input.traceId ?? null,
    captured_sha: input.capturedSha ?? null,
  };
}
