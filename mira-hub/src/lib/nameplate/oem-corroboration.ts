/**
 * OEM catalog corroboration — free independent evidence, no extra inference.
 *
 * By the time we get here the pipeline has already downloaded and extracted the
 * applicable OEM manual (48 pages / ~70k characters for the Oriental Motor
 * DGII case). That text is an INDEPENDENT observation of the same equipment,
 * produced by a completely different process from the camera. Using it costs
 * one string scan — no model, no RAM, no provider.
 *
 * It is worth being precise about what this module may and may not do.
 *
 *   The photograph said `AZM1A91-0`.
 *   The OEM manual contains `AZM911AC-D` on page 43.
 *
 * It is NOT allowed to conclude "the photograph says AZM911AC-D". The pixels
 * did not say that. What it may conclude is: the photographic reading is
 * ambiguous, and the confirmed OEM document contains a near-identical
 * identifier that differs only by characters OCR is known to confuse. That is
 * a *candidate with provenance*, which the evidence layer then reasons about
 * and a human can accept — never a silent autocorrect.
 *
 * Pure and offline: every rule here is directly testable and cannot drift with
 * a model change.
 */

/**
 * Character pairs OCR genuinely confuses on industrial plates — stamped,
 * engraved, or printed in narrow condensed fonts. A substitution drawn from
 * this set is weak evidence of a DIFFERENT identifier; a substitution outside
 * it is strong evidence the two strings are genuinely different parts.
 *
 * Deliberately conservative. Every pair here is one we have actually observed
 * or that is well attested on dot-matrix/engraved plates; adding speculative
 * pairs would let two real, distinct part numbers collapse into one.
 */
const CONFUSION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["0", "O"],
  ["0", "Q"],
  ["0", "D"],
  ["1", "I"],
  ["1", "L"],
  ["1", "7"],
  ["I", "L"],
  ["5", "S"],
  ["8", "B"],
  ["2", "Z"],
  ["6", "G"],
  ["9", "Q"],
  ["U", "V"],
  ["C", "G"],
];

const CONFUSABLE = new Set(
  CONFUSION_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
);

export function isConfusablePair(a: string, b: string): boolean {
  if (!a || !b) return false;
  return CONFUSABLE.has(`${a.toUpperCase()}|${b.toUpperCase()}`);
}

/** Separators OCR drops or invents freely; compared structurally, not as text. */
const SEPARATORS = /[-_/.\s]/g;

export function stripSeparators(s: string): string {
  return s.toUpperCase().replace(SEPARATORS, "");
}

/**
 * Levenshtein distance where a substitution between a known OCR-confusion pair
 * costs less than an arbitrary one. Two identifiers differing ONLY by confusable
 * characters score close to zero; two differing by a real character stay far
 * apart, which is what stops `AZM911AC-D` from matching a genuinely different
 * part in the same family.
 */
export function ocrDistance(a: string, b: string): number {
  const s = stripSeparators(a);
  const t = stripSeparators(b);
  if (s === t) return 0;
  const SUB_CONFUSABLE = 0.3;
  const SUB_OTHER = 1;
  const INDEL = 1;

  const prev: number[] = new Array(t.length + 1);
  const cur: number[] = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j * INDEL;

  for (let i = 1; i <= s.length; i++) {
    cur[0] = i * INDEL;
    for (let j = 1; j <= t.length; j++) {
      const cs = s[i - 1];
      const ct = t[j - 1];
      const subCost = cs === ct ? 0 : isConfusablePair(cs, ct) ? SUB_CONFUSABLE : SUB_OTHER;
      cur[j] = Math.min(
        prev[j] + INDEL, // delete
        cur[j - 1] + INDEL, // insert
        prev[j - 1] + subCost, // substitute
      );
    }
    for (let j = 0; j <= t.length; j++) prev[j] = cur[j];
  }
  return prev[t.length];
}

// ── Identifier extraction from OEM document text ─────────────────────────────

export interface DocumentPage {
  text: string;
  page: number;
}

export interface IdentifierCandidate {
  value: string;
  /** Pages the identifier appears on, ascending. */
  pages: number[];
  /** How many times it occurs across the document. */
  occurrences: number;
  /** True when it appears next to a MODEL / P/N / CAT-style label. */
  labelled: boolean;
}

/**
 * Plausible industrial part/catalog identifiers. Must mix letters and digits,
 * be plausibly long, and not be prose. This is intentionally a RECALL-oriented
 * filter — precision comes from matching against what the photo actually read,
 * not from guessing which token is "the" part number.
 */
// NOTE the shape: a trailing `[A-Z0-9]` after the optional dash groups would
// silently truncate a ONE-character suffix — `AZM911AC-D` came back as
// `AZM911AC`, dropping precisely the character that identifies the variant.
// Single-letter suffixes are extremely common in OEM part numbers, so the
// segments must be allowed to end the token.
const IDENTIFIER_RE = /\b[A-Z0-9]+(?:[-/][A-Z0-9]+)*\b/g;

/** Labels that sit beside a part number on a plate or in a manual's spec table. */
const LABEL_RE =
  /(model|type|p\s*\/\s*n|part\s*(no|number)?|cat(alog|\.)?\s*(no|number)?|order\s*(no|code)?)\b/i;

const STOPWORDS = new Set([
  "AC",
  "DC",
  "AND",
  "THE",
  "FOR",
  "USE",
  "SEE",
  "PDF",
  "USB",
  "LED",
  "CE",
  "UL",
  "IP",
  "NEMA",
  "ISO",
  "IEC",
  "PAGE",
  "FIG",
  "NOTE",
  "MAX",
  "MIN",
  "TYP",
]);

function looksLikeIdentifier(token: string): boolean {
  const bare = stripSeparators(token);
  if (bare.length < 5 || bare.length > 24) return false;
  if (STOPWORDS.has(bare)) return false;
  if (!/[A-Z]/.test(bare)) return false; // pure numbers are quantities, not parts
  if (!/[0-9]/.test(bare)) return false; // pure words are prose
  // Reject things that are overwhelmingly one repeated character.
  if (new Set(bare).size < 3) return false;
  return true;
}

/**
 * Harvest identifier candidates from the OEM document's extracted pages.
 * Ranked by whether they sit next to a label, then by how often they occur.
 */
export function extractIdentifierCandidates(pages: DocumentPage[]): IdentifierCandidate[] {
  const byValue = new Map<string, IdentifierCandidate>();

  for (const { text, page } of pages) {
    if (!text) continue;
    const upper = text.toUpperCase();
    for (const m of upper.matchAll(IDENTIFIER_RE)) {
      const token = m[0];
      if (!looksLikeIdentifier(token)) continue;
      // Was there a MODEL/P-N style label shortly before this token?
      const windowStart = Math.max(0, (m.index ?? 0) - 40);
      const labelled = LABEL_RE.test(text.slice(windowStart, (m.index ?? 0)));

      const existing = byValue.get(token);
      if (existing) {
        existing.occurrences += 1;
        if (!existing.pages.includes(page)) existing.pages.push(page);
        existing.labelled = existing.labelled || labelled;
      } else {
        byValue.set(token, { value: token, pages: [page], occurrences: 1, labelled });
      }
    }
  }

  const out = [...byValue.values()];
  for (const c of out) c.pages.sort((a, b) => a - b);
  out.sort(
    (a, b) =>
      Number(b.labelled) - Number(a.labelled) || b.occurrences - a.occurrences ||
      a.value.localeCompare(b.value),
  );
  return out;
}

// ── Matching an uncertain observation to the document ────────────────────────

export type MatchKind =
  | "exact" // identical ignoring separators
  | "confusable" // differs ONLY by characters OCR is known to confuse
  | "near" // small distance, but includes a non-confusable difference
  | "none";

export interface IdentifierMatch {
  observed: string;
  candidate: IdentifierCandidate;
  kind: MatchKind;
  distance: number;
  /** Technician-facing sentence. Never asserts the photo said the candidate. */
  reason: string;
}

/**
 * Compare one uncertain OCR reading against the document's identifiers.
 *
 * Thresholds are deliberately tight. `confusable` requires that EVERY differing
 * character be a known OCR confusion — that is the case where the document is
 * genuinely likely to be naming the same part the camera struggled with.
 * Anything looser is reported as `near`, which is a hint for a human, not
 * evidence.
 */
export function matchObservationToDocument(
  observed: string | null | undefined,
  candidates: IdentifierCandidate[],
  opts: { maxDistance?: number } = {},
): IdentifierMatch | null {
  if (!observed || !observed.trim()) return null;
  const maxDistance = opts.maxDistance ?? 1.2;

  let best: IdentifierMatch | null = null;
  for (const candidate of candidates) {
    const distance = ocrDistance(observed, candidate.value);
    if (best && distance >= best.distance) continue;

    let kind: MatchKind;
    if (distance === 0) kind = "exact";
    else if (distance <= 0.95 && sameLengthConfusableOnly(observed, candidate.value))
      kind = "confusable";
    else if (distance <= maxDistance) kind = "near";
    else continue;

    best = {
      observed,
      candidate,
      kind,
      distance: Number(distance.toFixed(2)),
      reason: describeMatch(observed, candidate, kind),
    };
  }
  return best;
}

/** True when the two strings differ ONLY by confusable characters (no indels). */
function sameLengthConfusableOnly(a: string, b: string): boolean {
  const s = stripSeparators(a);
  const t = stripSeparators(b);
  if (s.length !== t.length) return false;
  let differing = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === t[i]) continue;
    if (!isConfusablePair(s[i], t[i])) return false;
    differing += 1;
  }
  return differing > 0;
}

function describeMatch(
  observed: string,
  candidate: IdentifierCandidate,
  kind: MatchKind,
): string {
  const where = `page ${candidate.pages[0]}`;
  switch (kind) {
    case "exact":
      return `the confirmed OEM document contains ${candidate.value} (${where}), matching the photo`;
    case "confusable":
      return `the photo reads ${observed}; the confirmed OEM document contains ${candidate.value} (${where}), differing only by characters OCR commonly confuses — the photo is ambiguous, not corrected`;
    case "near":
      return `the photo reads ${observed}; the confirmed OEM document contains a similar identifier ${candidate.value} (${where}) — similar, but not by OCR confusion alone`;
    default:
      return "no comparable identifier found in the OEM document";
  }
}

/**
 * Should this match be offered as corroborating evidence to the evidence layer?
 *
 * `exact` and `confusable` qualify. `near` does NOT — a near match is shown to a
 * human as context but must not act as an independent source, because the whole
 * point of the confusable test is to distinguish "the camera misread this" from
 * "this is a different part in the same family".
 */
export function isCorroborating(match: IdentifierMatch | null): boolean {
  return match?.kind === "exact" || match?.kind === "confusable";
}
