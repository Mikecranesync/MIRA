/**
 * Shared negation layer for the hazard-affirmation floor.
 *
 * Pattern: NegEx (Chapman et al., J Biomed Inform 2009). Hazard detectors in
 * `answer-validation.ts` match only the AFFIRMATIVE unsafe shape. Whether a
 * match is cancelled by a negation is decided HERE, once, from the table
 * below — instead of by per-rule lookbehinds (26 of them before this module;
 * each Codex round found the next rule missing one).
 *
 * Scope is deliberately ADJACENT ONLY: a negation cancels a match only when
 * nothing but horizontal whitespace separates it from the match's first word
 * ("never keep…", "not safe to…", "No energized work…") — the exact binding
 * the removed lookbehinds had. Caution / myth / "not true that" FRAMES
 * ("never assume X", "it is a myth that X") are NOT modifiers: four Codex
 * rounds on #4201 showed that deciding whether a frame negates its claim is a
 * meaning question no enumerated grammar converges on. Framed hazards stay
 * flagged (as on main); a semantic layer may later decide those.
 *
 * Fail-closed: anything this layer cannot prove negated is NOT cancelled.
 * Deterministic, pure, no I/O. Only ever removes a match it can explain; it
 * never adds or clears any other gate.
 */

export type ModifierType = "negated";

export interface Modifier {
  readonly type: ModifierType;
  /** Trigger phrase source; matched case-insensitively and must END where the match begins. */
  readonly trigger: string;
}

/** Adjacent negations: bind the head directly ("not safe to", "never keep", "No energized work"). */
export const MODIFIERS: readonly Modifier[] = [
  { type: "negated", trigger: "not\\s+all|no|not|never|cannot|\\w+n't" },
];

/** Trigger-shaped phrases that do not negate. */
export const PSEUDO_TRIGGERS: readonly string[] = [
  "no\\s+doubt", "not\\s+only", "(?:whether\\s+)?or\\s+not", "no\\s+matter", "not\\s+just",
  "(?:never|don'?t|do\\s+not|doesn'?t|does\\s+not)\\s+think\\s+twice", "never\\s+mind", "no\\s+problem",
];

/** Clause boundaries: the nesting check and the trailing-predicate check stop here. */
export const TERMINATOR =
  /[.!?;:,\n]|—|–|\b(?:but|however|yet|although|though|and|then|so|because|before|after|when|whenever|while|whilst|until|once|if|unless|whereas)\b/i;

const TRIGGER_RES = MODIFIERS.map((m) => ({
  m,
  // trigger, then horizontal whitespace only, then the match.
  adjacent: new RegExp(`(?:^|[^\\w'])(${m.trigger})[ \\t]+$`, "i"),
  any: new RegExp(`(?:^|[^\\w'])(?:${m.trigger})\\b`, "gi"),
}));
// A negation binds a noun phrase or verb ("no energized work", "never keep"),
// not a clause opened by its own subject: "No you can reset it live" and
// "Not — it is safe to…" are affirmations, so a negation never governs a
// match that starts with a subject pronoun or "yes".
const CLAUSE_SUBJECT_START = /^(?:you|it|it's|we|i|they|he|she|yes|this|that)\b/i;
// The governed instruction must END with the match: a finite verb after it in
// the same clause ("never X … is dangerous") makes the negation deny something
// else, so the flag stays (#4201 Codex R2 F5).
const TRAILING_PREDICATE = /\b(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|shall|should|may|might|must|does|did|seems?|remains?|becomes?|counts?)\b|\w+n't\b/i;
// Polarity cues for the nesting check (#4201 Codex R1 F3).
const NEGATION_WORD = /\b(?:no|not|never|cannot|\w+n't)\b/gi;
// Determiner negations ("no", "not all") negate a noun phrase, never a verb:
// "No keep the machine energized…" / "No lifting … 2-ton hoist" are not
// prohibitions the layer can prove. They govern only a match that opens with
// an energized-state noun phrase — exactly the binding the removed per-rule
// lookbehinds gave "no" (energized-work-approved only).
const DETERMINER_NEGATION = /^(?:no|not\s+all)$/i;
const NP_HEAD = /^(?:energi[sz]ed|live|hot|power(?:ed)?)\b/i;
const PSEUDO_SRC = `(?:${PSEUDO_TRIGGERS.join("|")})`;
const PSEUDO_BEFORE_MATCH = new RegExp(`\\b${PSEUDO_SRC}[ \\t]+$`, "i");

export interface ModifierHit {
  readonly type: ModifierType;
  readonly trigger: string;
}

/**
 * The negation that governs the hazard match starting at `matchStart` in
 * `text`, or null. Scope begins at the match's first word character so a
 * clause-anchored match (which begins with its own ". " or "; ") cannot hide
 * the terminator inside the match.
 */
export function governingModifier(text: string, matchStart: number, matchEnd?: number): ModifierHit | null {
  const rel = text.slice(matchStart).search(/\w/);
  const start = rel < 0 ? matchStart : matchStart + rel;
  const before = text.slice(0, start);
  if (cueCount(before) > 1) return null;
  // The clause tail after the match — cut at a sentence end or ; : only, so a
  // parenthetical comma ("…, even briefly, is dangerous") stays visible.
  const tail = matchEnd === undefined ? "" : (text.slice(matchEnd).split(/[.!?;:\n]/)[0] ?? "");
  if (TRAILING_PREDICATE.test(tail.split(TERMINATOR)[0] ?? "")) return null;

  for (const { m, adjacent } of TRIGGER_RES) {
    const hit = adjacent.exec(before);
    if (!hit || PSEUDO_BEFORE_MATCH.test(before)) continue;
    if (CLAUSE_SUBJECT_START.test(text.slice(start))) continue;
    if (DETERMINER_NEGATION.test(hit[1].trim()) && !NP_HEAD.test(text.slice(start))) continue;
    return { type: m.type, trigger: hit[1] };
  }
  return null;
}

/**
 * Distinct negation cues (trigger phrases and bare negation words, merged
 * where they overlap) in the clause that ends at the match. More than one means
 * nested or polarity-reversing wording; the layer cannot establish that the
 * whole expression negates the hazard, so it cancels nothing.
 */
function cueCount(before: string): number {
  const cut = before.split(new RegExp(TERMINATOR.source, "gi")).pop() ?? "";
  const spans: [number, number][] = [];
  for (const { any } of TRIGGER_RES) {
    for (const h of cut.matchAll(new RegExp(any.source, "gi"))) spans.push([h.index!, h.index! + h[0].length]);
  }
  for (const h of cut.matchAll(NEGATION_WORD)) spans.push([h.index!, h.index! + h[0].length]);
  spans.sort((a, b) => a[0] - b[0]);
  let groups = 0;
  let end = -1;
  for (const [s0, e0] of spans) {
    if (s0 >= end) groups++;
    end = Math.max(end, e0);
  }
  return groups;
}

/**
 * First match of `re` in `text` that no negation governs, or null. Every
 * candidate start is tried, so a cancelled clause never hides a later
 * affirmative one ("Never keep X energized; energized work is approved").
 */
export function firstUngovernedMatch(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (!governingModifier(text, m.index, m.index + m[0].length)) return m;
    g.lastIndex = m.index + 1;
  }
  return null;
}
