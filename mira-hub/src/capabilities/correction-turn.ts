// #5133 — a technician correction ("that's not what I asked", "ignore that")
// must not get the previous answer back. On staging (10-27 22:07) "huh? thats
// not what i asked, i want the AMPS" was answered with the same 8.0 A / code
// 8P0 text it was correcting. Deterministic: a phrase detector plus a word-token
// overlap against the last assistant turn. No inference.

export const CORRECTION_REPEAT_TEXT =
  "That would repeat my last answer, so I won't send it again. What did you mean instead? Name the value, terminal or step you want.";

const CORRECTION_RE =
  /\b(?:that'?s|thats|that is) not what i (?:asked|meant|wanted)\b|\bnot what i (?:asked|meant|wanted)\b|\bignore (?:that|this)\b|\bwrong question\b|\bno,? i (?:meant|asked)\b/i;

/** True when the message corrects or dismisses the previous answer. */
export function isCorrectionTurn(message: string): boolean {
  return CORRECTION_RE.test(message);
}

function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/\[\d+\]/g, " ")
    .match(/[a-z0-9]+(?:\.[0-9]+)?/g);
  return new Set(words ?? []);
}

// Share of the draft's words already in the previous answer. Measured on the
// draft, not as Jaccard, because the stored previous answer can carry a safety
// banner the draft does not have yet. Staging: the two repeats score 1.00 and
// 0.91, the two genuinely new answers 0.18 and 0.42.
const REPEAT_CONTAINMENT = 0.75;

/**
 * True when `next` is a near-duplicate of `prev` (citation markers ignored).
 * A number in `next` that `prev` does not have is a new value, so a new answer.
 */
export function repeatsPrevious(prev: string, next: string): boolean {
  const a = tokens(prev);
  const b = tokens(next);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of b) {
    if (a.has(t)) shared++;
    else if (/\d/.test(t)) return false;
  }
  return shared / b.size >= REPEAT_CONTAINMENT;
}

/**
 * The clarifying text to send instead of `draft`, or null to keep the draft.
 * Replaces only when the message is a correction AND the draft repeats the
 * last assistant turn in `history`.
 */
export function correctionRepeatReplacement(
  message: string,
  draft: string,
  history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>,
): string | null {
  if (!isCorrectionTurn(message)) return null;
  let prev: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      prev = history[i].content;
      break;
    }
  }
  if (prev === null || !repeatsPrevious(prev, draft)) return null;
  return CORRECTION_REPEAT_TEXT;
}
