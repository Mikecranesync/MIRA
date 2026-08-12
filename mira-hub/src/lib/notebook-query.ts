/**
 * Industrial query normalization + multi-query expansion + deterministic rerank
 * for Equipment Notebook retrieval. Pure functions (unit-tested) — no I/O.
 *
 * Why this exists (measured, docs/RESUME_2026-08-12-notebook-retrieval-answer-fix.md):
 * the notebook retrieval loses technician questions to VOCABULARY MISMATCH, not
 * corpus size. "What parameter is the slow down ramp?" tokenizes to
 * `paramet & slow & ramp`; the answer chunk says "decel", so english BM25 never
 * matches it — while `plainto('deceleration')` matches 6 chunks. And exact IDs
 * (P042, F004, terminal 07) that DO match get out-ranked by same-page siblings
 * under ts_rank_cd. This module (a) expands a technician question into the
 * manufacturer's vocabulary, (b) extracts exact tokens that must be retrievable
 * verbatim, and (c) reranks so the exact-token / phrase-bearing chunk floats up.
 *
 * These are GENERAL industrial synonyms (deceleration, frequency families,
 * terminals, faults) — not question-specific answer rules.
 */

/** Domain synonym expansion: each trigger (matched as a whole phrase, case-
 *  insensitive) contributes manufacturer-vocabulary terms to the query set. */
const SYNONYMS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\bslow(?:\s|-)?down\b|\bramp\s*down\b|\bdecel\w*\b/i, ["deceleration", "decel time"]],
  [/\bspeed(?:\s|-)?up\b|\bramp\s*up\b|\baccel\w*\b/i, ["acceleration", "accel time"]],
  [/\bramp\b/i, ["accel time", "decel time"]],
  [/\bsecond\s+speed\b|\b2nd\s+speed\b/i, ["speed reference 2", "preset frequency", "start source 2"]],
  [/\bmotor\s+freq\w*\b/i, ["motor np hertz", "nameplate", "maximum freq", "minimum freq", "output freq"]],
  [/\bmotor\s+speed\b/i, ["output freq", "commanded freq", "preset freq"]],
  [/\b(nameplate|name\s*plate)\b/i, ["motor np hertz", "motor np volts", "motor np amps"]],
  [/\bpreset\b/i, ["preset freq"]],
  [/\bterminal\b|\bwire\b|\binput\b/i, ["digin termblk", "terminal block"]],
  [/\bfault\b|\btrip\b|\balarm\b|\berror\s*code\b/i, ["fault"]],
  [/\breset\b|\bclear\b/i, ["fault clear"]],
  [/\btorque\b/i, ["torque"]],
  [/\bmax(?:imum)?\s+freq\w*\b/i, ["maximum freq"]],
  [/\bmin(?:imum)?\s+freq\w*\b/i, ["minimum freq"]],
];

/** Patterns for exact tokens that MUST be retrievable verbatim (they name a
 *  specific row). Order matters only for de-dup; all are collected. */
const EXACT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[PpAaBbCcHhLdtUu]\d{2,4}\b/g, // parameter IDs: P042, A410, b001, t067, C123, d012
  /\bF\d{2,4}\b/gi, // fault codes: F004
  /\b25[AB]-[A-Z0-9]+\b/gi, // PowerFlex catalog numbers
  /\b\d{2,3}-[A-Z]\d{2,}\b/gi, // generic catalog-ish
];

export type ExpandedQuery = {
  /** The original query FIRST, then de-duped synonym-augmented variants. */
  variants: string[];
  /** Verbatim tokens (uppercased) the answer chunk is likely keyed on. */
  exactTokens: string[];
  /** Quoted phrases the user asked to match verbatim. */
  phrases: string[];
};

export function expandIndustrialQuery(query: string): ExpandedQuery {
  const q = query.trim();
  const lower = q.toLowerCase();

  const synTerms = new Set<string>();
  for (const [re, terms] of SYNONYMS) {
    if (re.test(q)) for (const t of terms) synTerms.add(t);
  }

  const exact = new Set<string>();
  for (const re of EXACT_PATTERNS) {
    for (const m of q.matchAll(re)) {
      const tok = m[0];
      // Skip bare small numbers already covered; keep alnum IDs.
      if (/^[a-z]/i.test(tok) || /-/.test(tok)) exact.add(tok.toUpperCase());
    }
  }
  // "terminal 07" / "term 7" → the terminal number as an exact token.
  for (const m of lower.matchAll(/\b(?:terminal|term|digital input|din)\s*#?\s*0*(\d{1,2})\b/g)) {
    exact.add(`0${m[1]}`.slice(-2)); // 7 → "07"
  }

  const phrases = [...q.matchAll(/"([^"]{2,})"/g)].map((m) => m[1]);

  // Build variants: original first (precision), then original + each synonym
  // group folded in (recall in manufacturer vocabulary). Cap to keep round-trips
  // bounded.
  const variants = [q];
  if (synTerms.size) variants.push(`${q} ${[...synTerms].join(" ")}`);
  // Also a pure-synonym variant so the original off-vocabulary words don't dilute.
  if (synTerms.size) variants.push([...synTerms].join(" "));

  return {
    variants: [...new Set(variants)].slice(0, 4),
    exactTokens: [...exact].slice(0, 8),
    phrases: phrases.slice(0, 4),
  };
}

export type Rerankable = {
  content: string;
  rank: number; // ts_rank_cd from SQL (may be 0 for ILIKE-only candidates)
  sourcePage: number | null;
  docId: string | null;
};

/**
 * Deterministic rerank of a widened candidate pool. Score = normalized ts_rank
 * + big boost for a chunk that contains an exact token (param ID / fault code /
 * terminal) verbatim + boost for verbatim quoted phrases + boost for synonym
 * term presence. Exact-token presence dominates: a chunk that literally contains
 * "P042" must beat a same-page sibling that merely shares generic words.
 */
export function rerankChunks<T extends Rerankable>(
  expanded: ExpandedQuery,
  chunks: T[],
): T[] {
  const exact = expanded.exactTokens.map((t) => t.toLowerCase());
  const phrases = expanded.phrases.map((p) => p.toLowerCase());
  const synTerms = expanded.variants
    .slice(1)
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const maxRank = Math.max(1e-6, ...chunks.map((c) => c.rank));
  const scored = chunks.map((c, i) => {
    const text = c.content.toLowerCase();
    let score = (c.rank / maxRank) * 1.0; // 0..1 base
    let exactHit = false;
    for (const t of exact) {
      if (t && text.includes(t)) {
        score += 3.0; // dominant: exact ID present verbatim
        exactHit = true;
      }
    }
    for (const p of phrases) if (p && text.includes(p)) score += 2.0;
    let synHits = 0;
    for (const s of synTerms) if (text.includes(s)) synHits++;
    score += Math.min(synHits, 4) * 0.4;
    return { c, score, exactHit, i };
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.c);
}
