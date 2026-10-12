/**
 * Weak-evidence badge — the one rule the Jev sufficiency shadow is consulted
 * for, and the only thing it is allowed to change.
 *
 * Source: `docs/proofs/2026-10-12-jev-shadow-adjudication.md`
 * § "What this window says about MIRA". Across 34 adjudicated text turns the
 * shadow was right on 31; every answer that carried a unit claim or a citation
 * while scoring under 0.30 on an OEM-documentation basis was MIRA answering
 * from pages that did not answer the question (#3950 / #3966, the tag-sheet
 * meaning invention of #4379). So that exact conjunction, and nothing wider,
 * earns a caption that says the documentation may not cover the question.
 *
 * What this rule is NOT:
 *  - not a gate: the answer is delivered unchanged, with its citations;
 *  - not a clarifying question: a low score cannot tell "ambiguous question"
 *    from "not in the manual", and the second already gets MIRA's limitation
 *    answer;
 *  - not a judgement on photo or machine turns: those bases are excluded by
 *    construction, because the shadow judged a photo turn on chunks alone
 *    until sufficiency-v2 and a machine turn rests on signals, not pages.
 *
 * Pure. No I/O, no env read — the route gates on the flag
 * (`jevWeakEvidenceBadgeEnabled`) and feeds the packet's own fields.
 */

/** Below this `jev_sufficient` the adjudication found the documentation did
 *  not cover the question in 20 of 22 low-scoring text turns. */
export const JEV_WEAK_EVIDENCE_THRESHOLD = 0.3;

/** Replaces the OEM-documentation caption on the evidence frame when the rule
 *  fires. Says what the pages are, and what they may not be — never that the
 *  answer is wrong. */
export const WEAK_EVIDENCE_LABEL =
  "Documentation may not cover this — the cited pages may not answer the question.";

/** The rule name persisted with the badge, so a later adjudication can tell
 *  which rule version produced a historical badge. Bump on any change to the
 *  threshold or the conjunction. */
export const WEAK_EVIDENCE_RULE = "jev_sufficiency_v1";

export type WeakEvidenceSignals = {
  /** `answer_gate.jev_sufficient` — null when the shadow did not run. */
  jevSufficient: number | null;
  /** The evidence frame's basis for this turn, or null when it has none. */
  basis: string | null;
  /** `answer_gate.ungrounded_unit_claim`. */
  ungroundedUnitClaim: boolean;
  /** `answer_gate.citations_shipped`. */
  citationsShipped: number;
};

/**
 * `jev_sufficient < 0.30 AND basis = oem_documentation AND
 * (ungrounded_unit_claim OR citations_shipped > 0)`.
 *
 * Stated exactly as the adjudication proposed it, and that is deliberate even
 * though the notebook chat route cannot exercise the last term on its own: the
 * route assigns `basis = "oem_documentation"` only when it shipped at least one
 * citation (chat/route.ts, the evidence-frame ladder), so on THAT caller the
 * disjunct is already true whenever the basis matches, and the production rule
 * reduces to `score < 0.30 AND basis = oem_documentation`. The unit-claim term
 * is kept because it is part of the owner-accepted rule, because a future
 * caller (the hub ask route, replay from stored packets) may hold a basis
 * without shipped citations, and because the D2 bucket — a unit claim with no
 * citation — is the shape the adjudication most wanted caught. Gate 7 review
 * of #4381 named this; it is a documented reduction, not a hidden one.
 *
 * A missing, non-finite or out-of-range score is "not consulted", never
 * "weak": the shadow is fail-open and a skipped call must not badge anything.
 */
export function isWeakEvidence(s: WeakEvidenceSignals): boolean {
  const score = s.jevSufficient;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return false;
  if (score >= JEV_WEAK_EVIDENCE_THRESHOLD) return false;
  if (s.basis !== "oem_documentation") return false;
  return s.ungroundedUnitClaim === true || s.citationsShipped > 0;
}
