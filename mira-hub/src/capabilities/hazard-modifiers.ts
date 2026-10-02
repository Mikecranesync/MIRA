/**
 * ConText-style modifier layer for the hazard-affirmation floor.
 *
 * Pattern: NegEx / ConText (Chapman et al., J Biomed Inform 2009). Hazard
 * detectors in `answer-validation.ts` match only the AFFIRMATIVE unsafe shape.
 * Whether that statement is cancelled by surrounding wording — "never",
 * "not all", "never assume", "some people say" — is decided HERE, once, from
 * the table below, instead of by per-rule lookbehinds (26 of them before this
 * module; each Codex round found the next rule missing one).
 *
 * A modifier cancels a match only when the match lies inside its scope:
 *  - `adjacent`: only whitespace between trigger and the match's first word
 *    (the exact binding the removed lookbehinds had — never wider);
 *  - `window`: up to WINDOW_WORDS words, and no TERMINATOR, between trigger
 *    and the match's first word.
 * A terminator (sentence end, ; : , dashes, but/however/yet/although/though,
 * and/then/so) always ends scope, so "Never assume X, but energized work is
 * approved" stays flagged. Pseudo-triggers are trigger-shaped phrases that do
 * not negate ("no doubt", "whether or not") and are skipped.
 *
 * Fail-closed: anything this layer cannot place in scope is NOT cancelled.
 * Deterministic, pure, no I/O. Only ever removes a match it can explain; it
 * never adds or clears any other gate.
 */

export type ModifierType = "negated" | "caution" | "hypothetical";
export type ModifierScope = "adjacent" | "window";

export interface Modifier {
  readonly type: ModifierType;
  readonly scope: ModifierScope;
  /** Trigger phrase source; matched case-insensitively and must END where scope begins. */
  readonly trigger: string;
}

/** Forward-scoped modifiers, most specific first. */
export const MODIFIERS: readonly Modifier[] = [
  // caution: the complement is a false belief the technician is warned against.
  { type: "caution", scope: "window", trigger: "(?:never|don'?t|do\\s+not|doesn'?t|does\\s+not)\\s+(?:assume|think|believe|expect|presume|suppose)(?:\\s+that)?" },
  { type: "caution", scope: "window", trigger: "(?:it\\s+is|it'?s)\\s+(?:never|not)\\s+(?:true|the\\s+case)\\s+that" },
  // hypothetical: only frames that explicitly mark the claim FALSE. Bare
  // attribution ("some manuals say …", "others say …") is NOT a modifier: it
  // is the #3790 authority shape, and nothing in it says the claim is wrong.
  // No bare "if" either — it conditions instructions as often as it disclaims.
  { type: "hypothetical", scope: "window", trigger: "(?:it\\s+is|it'?s)\\s+a\\s+(?:common\\s+)?(?:myth|misconception)\\s+that" },
  // negated: binds the head directly ("not safe to", "never keep", "No energized work").
  { type: "negated", scope: "adjacent", trigger: "not\\s+all|no|not|never|cannot|\\w+n't" },
];

/** Trigger-shaped phrases that do not negate or disclaim. */
export const PSEUDO_TRIGGERS: readonly string[] = [
  "no\\s+doubt", "not\\s+only", "(?:whether\\s+)?or\\s+not", "no\\s+matter", "not\\s+just",
  "don'?t\\s+think\\s+twice", "never\\s+mind", "no\\s+problem",
];

export const TERMINATOR =
  /[.!?;:,\n]|—|–|\b(?:but|however|yet|although|though|and|then|so|because)\b/i;

const WINDOW_WORDS = 8;

const TRIGGER_RES = MODIFIERS.map((m) => ({
  m,
  // adjacent: trigger, then horizontal whitespace only, then the match.
  adjacent: new RegExp(`(?:^|[^\\w'])(${m.trigger})[ \\t]+$`, "i"),
  any: new RegExp(`(?:^|[^\\w'])(?:${m.trigger})\\b`, "gi"),
}));
// A negation binds a noun phrase or verb ("no energized work", "never keep"),
// not a clause opened by its own subject: "No you can reset it live" and
// "Not — it is safe to…" are affirmations, so negated modifiers never govern
// a match that starts with a subject pronoun or "yes".
const CLAUSE_SUBJECT_START = /^(?:you|it|it's|we|i|they|he|she|yes|this|that)\b/i;
const PSEUDO_SRC = `(?:${PSEUDO_TRIGGERS.join("|")})`;
const PSEUDO_BEFORE_MATCH = new RegExp(`\\b${PSEUDO_SRC}[ \\t]+$`, "i");
const PSEUDO_AT = new RegExp(`^\\W*${PSEUDO_SRC}\\b`, "i");

export interface ModifierHit {
  readonly type: ModifierType;
  readonly trigger: string;
}

/**
 * The modifier whose scope covers the hazard match starting at `matchStart`
 * in `text`, or null. Scope begins at the match's first word character so a
 * clause-anchored match (which begins with its own ". " or "; ") cannot hide
 * the terminator inside the match.
 */
export function governingModifier(text: string, matchStart: number): ModifierHit | null {
  const rel = text.slice(matchStart).search(/\w/);
  const start = rel < 0 ? matchStart : matchStart + rel;
  const before = text.slice(0, start);

  for (const { m, adjacent, any } of TRIGGER_RES) {
    if (m.scope === "adjacent") {
      const hit = adjacent.exec(before);
      if (!hit || PSEUDO_BEFORE_MATCH.test(before)) continue;
      if (CLAUSE_SUBJECT_START.test(text.slice(start))) continue;
      return { type: m.type, trigger: hit[1] };
    }
    // window: the LAST occurrence of the trigger before the match.
    let last: RegExpExecArray | null = null;
    any.lastIndex = 0;
    for (let h = any.exec(before); h; h = any.exec(before)) last = h;
    if (!last || PSEUDO_AT.test(before.slice(last.index))) continue;
    const gap = before.slice(last.index + last[0].length);
    if (TERMINATOR.test(gap)) continue;
    if (gap.trim().split(/\s+/).filter(Boolean).length > WINDOW_WORDS) continue;
    return { type: m.type, trigger: last[0].trim() };
  }
  return null;
}

/**
 * First match of `re` in `text` that no modifier governs, or null. Every
 * candidate start is tried, so a cancelled clause never hides a later
 * affirmative one ("Never assume X; energized work is approved").
 */
export function firstUngovernedMatch(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (!governingModifier(text, m.index)) return m;
    g.lastIndex = m.index + 1;
  }
  return null;
}
