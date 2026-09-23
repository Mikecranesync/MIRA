/**
 * "Evidence supplied" is not "evidence followed."  — #3962
 *
 * On staging 4bb5397a0 a technician photographed a bearing box, MIRA read the
 * label correctly ("32906X Tapered Roller Bea…"), and then answered a text-only
 * follow-up — "it is chattering, what do I check first" — about a VARIABLE
 * FREQUENCY DRIVE. The server had recalled the photo by itself; the packet
 * proved it reached the prompt (`observation_in_context: true`). Every gate said
 * healthy: `answered`, `evidence_sufficient: true`, no anomaly. A strong lexical
 * prior ("chattering" → contactor/drive chatter) simply beat the technician's
 * own evidence, silently.
 *
 * The same class, measured again on 2026-09-23 with documents instead of a
 * photo: the live acceptance loop retrieved 6 OEM chunks and 1 notebook chunk
 * and shipped answers with ZERO citations under a `general_reasoning` badge, on
 * runs whose earlier repeats had cited correctly. Evidence in the prompt,
 * evidence ignored, nothing red.
 *
 * WHAT THIS IS, AND IS NOT
 * This is an ASSESSMENT with a version, not a verdict about the model's
 * reasoning. Nothing here can see why an answer was written. It reports a
 * MEASURABLE INCONSISTENCY between what was supplied and what the answer talks
 * about — a prompt to go look at the trace, which is exactly what did not exist
 * when #3962 had to be found by a human reading both sides.
 *
 * Deliberately two-sided, because one side alone is not evidence:
 *   - "the answer omits the subject's identifiers" is weak on its own (a
 *     perfectly good general answer may never repeat a part number), and
 *   - noun overlap alone is the trap #3939 §5 explicitly warns against.
 * So a mismatch is only reported when the subject's identifiers are ALL absent
 * AND the answer commits to a DIFFERENT equipment class than the evidence did.
 *
 * ⚠️ MEASURED INEFFECTIVE, 2026-09-23. Against 5 real live divergences from
 * staging this rule caught ZERO (recall 0.00, false-positive rate 0.00 over 3
 * controls). Root cause is the "overlap" clause below: every one of those
 * answers led with "a loose or worn drive coupling" and mentioned "bearing" once
 * in a list far beneath it, so the class sets overlapped and the answer was
 * called consistent. A passing mention buys immunity from a check about what the
 * answer is ABOUT.
 *
 * It is retained because it is free, has no false positives, and its signals
 * (`subject_identifiers_in_answer`, the class sets) are recorded either way —
 * but do NOT read a `consistent` verdict as evidence the answer followed the
 * evidence. The redesign is a LEAD-SUBJECT rule (judge the answer's opening
 * recommendation, not token presence anywhere in it), and it must be validated
 * on a FRESH sample: the 8 pairs that exposed this weakness also defined the
 * ground-truth label, so scoring that redesign against them would be circular.
 * Experiment: docs/proofs/2026-09-23-3962-detector-comparison.md
 *
 * NO TEXT IS EVER STORED. Like `ungroundedUnitClaim`, this runs in-route on the
 * raw strings and only the verdict, the version and small counts reach the
 * packet. (A consequence worth stating: it cannot be recomputed later over
 * stored packets — the packet holds no answer text, by design.)
 */

/** Bump when the extraction or the decision rule changes, so a stored verdict
 *  is always interpretable against the rule that produced it. */
export const EVIDENCE_CONSISTENCY_VERSION = "1" as const;

export type EvidenceFollowedVerdict =
  /** No visual observation in context — nothing to be consistent with. */
  | "not_applicable"
  /** The answer references the subject, or commits to no competing class. */
  | "consistent"
  /** Subject identifiers all absent AND a different equipment class asserted.
   *  Named `unverified` because it is a signal to inspect, never a finding. */
  | "unverified_mismatch";

export type EvidenceFollowedAssessment = {
  version: typeof EVIDENCE_CONSISTENCY_VERSION;
  verdict: EvidenceFollowedVerdict;
  /** How many distinctive identifiers the observation yielded. */
  subject_identifiers: number;
  /** How many of them the answer referenced. */
  subject_identifiers_in_answer: number;
  /** Equipment classes the OBSERVATION names. */
  evidence_classes: string[];
  /** Equipment classes the ANSWER names. */
  answer_classes: string[];
};

/**
 * A deliberately small, closed vocabulary. Small because every entry is a chance
 * to be wrong, and a detector that fires on a healthy answer is worth less than
 * no detector at all — that is the #3963 lesson, applied before the fact rather
 * than after.
 */
const EQUIPMENT_CLASSES: ReadonlyArray<readonly [string, RegExp]> = [
  ["bearing", /\bbearings?\b|\btapered roller\b|\bspalling\b|\bbrinell\w*\b|\brace(?:way)?s?\b/i],
  ["drive", /\bvfd\b|\bvariable[- ]frequency\b|\binverter\b|\bdc bus\b|\bdrive\b/i],
  ["motor", /\bmotors?\b|\bstators?\b|\brotors?\b/i],
  ["contactor", /\bcontactors?\b|\brelays?\b|\bcoils?\b/i],
  ["encoder", /\bencoders?\b|\bresolvers?\b/i],
  ["valve", /\bvalves?\b|\bsolenoids?\b/i],
  ["pump", /\bpumps?\b|\bimpellers?\b/i],
  ["gearbox", /\bgearbox(?:es)?\b|\bgear(?:s|ing)?\b/i],
  ["belt", /\bbelts?\b|\bsheaves?\b|\bpulleys?\b|\bchains?\b|\bsprockets?\b/i],
  ["sensor", /\bproximity\b|\bphoto ?eye\b|\bsensors?\b/i],
  ["breaker", /\bbreakers?\b|\bfuses?\b/i],
  ["cylinder", /\bcylinders?\b|\bactuators?\b/i],
];

/**
 * Distinctive identifiers: part/model codes, not words. A token qualifies when
 * it mixes letters and digits (`32906X`, `6203ZZ`, `PF525`) or is a long bare
 * number — the things that actually identify THIS part, and the things a
 * technician would notice missing from an answer about it.
 *
 * Plain nouns are deliberately excluded: matching on those is the noun-overlap
 * heuristic this must not rest on.
 */
export function subjectIdentifiers(observation: string): string[] {
  const out = new Set<string>();
  for (const raw of observation.split(/[^A-Za-z0-9-]+/)) {
    const tok = raw.replace(/^-+|-+$/g, "");
    if (tok.length < 4 || tok.length > 24) continue;
    const hasDigit = /\d/.test(tok);
    const hasAlpha = /[A-Za-z]/.test(tok);
    if (hasDigit && (hasAlpha || tok.length >= 5)) out.add(tok.toUpperCase());
  }
  return [...out];
}

/** Every class a text names. Sets, not a single label: a real troubleshooting
 *  answer names several ("check the drive, the motor, the encoder"), and
 *  demanding exactly one would have missed #3962 itself. */
export function equipmentClassesOf(text: string): string[] {
  return EQUIPMENT_CLASSES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/**
 * Assess whether an answer engaged with the visual evidence it was handed.
 *
 * `observation` is the extracted text of the photo observation that was in
 * context for this turn (the recalled one on a follow-up). Empty ⇒
 * `not_applicable`; there is nothing to be inconsistent with.
 */
export function assessEvidenceFollowed(
  observation: string | null | undefined,
  answerText: string | null | undefined,
): EvidenceFollowedAssessment {
  const obs = (observation ?? "").trim();
  const ans = (answerText ?? "").trim();
  const base = {
    version: EVIDENCE_CONSISTENCY_VERSION,
    subject_identifiers: 0,
    subject_identifiers_in_answer: 0,
    evidence_classes: [] as string[],
    answer_classes: [] as string[],
  };
  if (!obs || !ans) return { ...base, verdict: "not_applicable" };

  const ids = subjectIdentifiers(obs);
  const upperAnswer = ans.toUpperCase();
  const matched = ids.filter((id) => upperAnswer.includes(id));
  const evidenceClasses = equipmentClassesOf(obs);
  const answerClasses = equipmentClassesOf(ans);

  const signals = {
    ...base,
    subject_identifiers: ids.length,
    subject_identifiers_in_answer: matched.length,
    evidence_classes: evidenceClasses,
    answer_classes: answerClasses,
  };

  // Side 1: the answer referenced the subject by identifier. Consistent,
  // whatever else it talks about.
  if (matched.length > 0) return { ...signals, verdict: "consistent" };
  // Side 2: a competing commitment. Both sides must name something, and the
  // answer must name NOTHING the evidence named — an answer that mentions the
  // evidence's class at all, among others, is not the failure being detected.
  const overlap = answerClasses.some((c) => evidenceClasses.includes(c));
  if (evidenceClasses.length === 0 || answerClasses.length === 0 || overlap) {
    return { ...signals, verdict: "consistent" };
  }
  return { ...signals, verdict: "unverified_mismatch" };
}
