/**
 * Claim-centered citation quotes (CIT-07 phase 2).
 *
 * The citation `quote` used to be `content.slice(0, 240)` — the chunk HEAD —
 * so the passage a technician saw when tapping a chip often ended just before
 * the value the answer actually cited (the 2026-08-13 QA finding: the torque
 * spec sat outside the window). This helper picks the ~span-char window of the
 * chunk most lexically relevant to the QUESTION, deterministically (zero-token
 * — no model call): sentence-ish segmentation, score by distinct shared terms
 * (digit-bearing tokens like "0.71" / "f004" count from length 2), best
 * segment wins, ties go to the earliest. No term overlap ⇒ head window
 * (yesterday's behavior).
 */

const SEGMENT_RE = /[^.!?:;\n]+[.!?:;\n]*/g;

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9.]+/)) {
    const t = raw.replace(/^\.+|\.+$/g, "");
    if (!t) continue;
    const minLen = /\d/.test(t) ? 2 : 3;
    if (t.length >= minLen) seen.add(t);
  }
  return [...seen];
}

// Words a question uses to say a number IS the claim ("fault 2310", "the F004 fault").
const CLAIM_NOUNS = new Set([
  "fault", "faults", "error", "errors", "alarm", "alarms", "warning", "warnings",
  "code", "codes", "parameter", "parameters", "param", "params",
]);
// Words that open an equipment phrase ("on the GS10", "my 525").
const DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "my", "our", "your", "their", "its",
]);

/**
 * The query terms that name the CLAIM asked about, not the machine it is asked about:
 * a number the question labels with a claim noun ("fault 2310", "the F004 fault"), or a
 * code mixing letters and digits ("f004", "p033") outside an equipment phrase ("the GS10").
 * A bare integer ("PowerFlex 525") names a model, series or quantity and stays an
 * ordinary term. A letter-bearing model with no determiner ("on PF525") still reads as
 * a code: the question's wording cannot tell it from one like "CE10".
 */
export function claimIdentifiers(query: string): Set<string> {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
  const ids = new Set<string>();
  words.forEach((w, i) => {
    if (w.length < 2 || !/\d/.test(w)) return;
    const prev = words[i - 1] ?? "";
    const next = words[i + 1] ?? "";
    if (CLAIM_NOUNS.has(prev) || CLAIM_NOUNS.has(next)) ids.add(w);
    else if (/[a-z]/.test(w) && !DETERMINERS.has(prev)) ids.add(w);
  });
  return ids;
}

export function relevantQuoteWindow(text: string, query: string, span = 240): string {
  const clean = text.trim();
  if (clean.length <= span) return clean;

  const terms = queryTerms(query);
  // A claim identifier ("f004", "p033") names the claim; plain words ("does",
  // "drive") appear in many rows of a fault table. One identifier match must
  // outweigh every plain-word match combined, or the quote lands on the row with
  // the most common words (the 2026-10-07 F004→F007 miss). A model number is not
  // a claim identifier, or the quote lands on the heading that names the model.
  // An identifier carries that much weight, so it matches whole codes only:
  // "fault 15" must not land on the "Fault 150" row.
  const exact = new Map(
    [...claimIdentifiers(query)].map((t) => [
      t,
      new RegExp(`(?<![a-z0-9])${t.replace(/\./g, "\\.")}(?![a-z0-9])`),
    ]),
  );
  const identifierWeight = terms.length + 1;
  let bestStart = 0;
  let bestScore = 0;
  if (terms.length > 0) {
    for (const m of clean.matchAll(SEGMENT_RE)) {
      const seg = m[0].toLowerCase();
      let score = 0;
      for (const t of terms) {
        const id = exact.get(t);
        if (id) score += id.test(seg) ? identifierWeight : 0;
        else if (seg.includes(t)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = m.index ?? 0;
      }
    }
  }
  if (bestScore === 0) return clean.slice(0, span); // head fallback

  // Center the window on the winning segment; clamp to the text bounds.
  let start = Math.max(0, Math.min(bestStart - Math.floor(span / 4), clean.length - span));
  // Snap forward to a word boundary so the quote never opens mid-word.
  if (start > 0) {
    const nextSpace = clean.indexOf(" ", start);
    if (nextSpace !== -1 && nextSpace - start < 40) start = nextSpace + 1;
  }
  return (start > 0 ? "…" : "") + clean.slice(start, start + span);
}
