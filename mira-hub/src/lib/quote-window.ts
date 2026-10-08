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

// The words that mark a code as the claim a question asks about.
const CLAIM_NOUNS = new Set([
  "fault", "faults", "error", "errors", "alarm", "alarms", "warning", "warnings",
  "code", "codes", "parameter", "parameters", "param", "params",
]); // "fault F004", "parameter 41"
const MEANS = new Set(["mean", "means", "meaning"]); // "what does F004 mean"
const TRIPS = new Set(["trip", "trips", "tripped", "tripping"]); // "trip with F005"

/**
 * The query terms the question itself marks as the CLAIM it asks about: a code after a
 * claim noun ("fault 2310"), before "mean" ("what does F004 mean"), or after a trip
 * ("trip with F005"). Only these outrank plain words.
 *
 * Every other digit-bearing term keeps the ordinary weight it had before, because a
 * question's wording cannot tell a model ("on GS10", "PowerFlex 525") from an unmarked
 * code, and a model given claim weight pulls the quote onto the heading that names it.
 * An unmarked term therefore scores exactly as it did before claim weighting existed.
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
    const marked =
      CLAIM_NOUNS.has(prev) ||
      MEANS.has(words[i + 1] ?? "") ||
      (prev === "with" && TRIPS.has(words[i - 2] ?? ""));
    if (marked) ids.add(w);
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
  // the most common words (the 2026-10-07 F004→F007 miss).
  // An identifier carries that much weight, so it matches whole codes only, and it is
  // matched against the whole chunk rather than per segment: "fault 15" must not land
  // on "Fault 150", and the segmenter splits "Fault 15.1" at its dot, so a per-segment
  // test would read the "Fault 15." fragment as Fault 15 (and never see "1.07" whole).
  // A dot followed by a letter or digit continues a code; a sentence-ending dot does not.
  // Each identifier maps to the offsets where it starts in `clean`.
  const hits = new Map(
    [...claimIdentifiers(query)].map((t) => {
      const re = new RegExp(
        `(?<![a-z0-9]|[a-z0-9]\\.)${t.replace(/\./g, "\\.")}(?![a-z0-9]|\\.[a-z0-9])`,
        "gi",
      );
      return [t, [...clean.matchAll(re)].map((h) => h.index ?? 0)];
    }),
  );
  const identifierWeight = terms.length + 1;
  let bestStart = 0;
  let bestScore = 0;
  if (terms.length > 0) {
    for (const m of clean.matchAll(SEGMENT_RE)) {
      const seg = m[0].toLowerCase();
      const segStart = m.index ?? 0;
      const segEnd = segStart + m[0].length;
      let score = 0;
      for (const t of terms) {
        const at = hits.get(t);
        if (at) score += at.some((i) => i >= segStart && i < segEnd) ? identifierWeight : 0;
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
