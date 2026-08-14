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

export function relevantQuoteWindow(text: string, query: string, span = 240): string {
  const clean = text.trim();
  if (clean.length <= span) return clean;

  const terms = queryTerms(query);
  let bestStart = 0;
  let bestScore = 0;
  if (terms.length > 0) {
    for (const m of clean.matchAll(SEGMENT_RE)) {
      const seg = m[0].toLowerCase();
      let score = 0;
      for (const t of terms) if (seg.includes(t)) score++;
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
