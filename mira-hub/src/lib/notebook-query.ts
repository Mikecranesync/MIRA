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

// ---------------------------------------------------------------------------
// Multi-turn conversation memory
//
// The notebook chat was single-shot: the route received only {message} and sent
// the model `[system, one-user]`, so a follow-up like "let's use Ethernet" or
// "what parameter changes first?" reached the model with ZERO prior context and
// retrieved on its own thin words. These helpers (a) sanitize/cap the history the
// client now sends so it can ride in the model messages, and (b) rewrite the
// RETRIEVAL query for a referential follow-up by folding in salient tokens the
// technician already used earlier in the thread. They NEVER invent equipment
// facts — they only reuse words already present in the transcript.
// ---------------------------------------------------------------------------

export type ChatHistoryTurn = { role: "user" | "assistant"; content: string };

const HISTORY_ROLES = new Set(["user", "assistant"]);

/** Validate + cap client-supplied history: keep only well-formed user/assistant
 *  turns with non-empty content, trim + hard-cap each turn's length, and keep the
 *  most recent `maxTurns` in order. Defensive against a bloated or malformed body. */
export function sanitizeHistory(raw: unknown, maxTurns = 6, maxChars = 2000): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatHistoryTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const role = (t as { role?: unknown }).role;
    const content = (t as { content?: unknown }).content;
    if (typeof role !== "string" || !HISTORY_ROLES.has(role)) continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role: role as "user" | "assistant", content: trimmed.slice(0, maxChars) });
  }
  return out.slice(-maxTurns);
}

// Referential signals. NOTE: a bare "this"/"that" mid-sentence is usually a
// determiner ("this drive", "that fault") — extremely common in self-contained
// first-turn questions — so it is NOT treated as referential. We only augment
// when a pronoun is used AS a pronoun: right before a verb ("what should THAT be
// set to?"), at the end of the sentence ("why is it doing THAT?"), or when the
// message is very short / opens with a follow-up connective.
const FOLLOWUP_LEAD = /^(and|so|but|no|ok|okay|then|what about|how about|why|what if|now)\b/i;
const PRONOUN = "(?:it|that|this|those|these|one|mine|them)";
const PRONOUN_VERB = new RegExp(
  `\\b${PRONOUN}\\s+(?:is|are|was|were|be|been|mean|means|do|does|did|should|would|will|wo|can|could|go|goes|work|works|change|changes|set|fault|faults|help)\\b`,
  "i",
);
const PRONOUN_END = new RegExp(`\\b${PRONOUN}\\b[\\s?.!,'’]*$`, "i");
const REFERENTIAL_PHRASE = /\b(the other|the same|another|that one|this one|the previous|like that)\b/i;

/** A short or genuinely referential message ("the other one", "what about
 *  Ethernet?", "what should that be set to?") needs conversational context to
 *  retrieve well; a long self-contained question ("...on this drive?") does not. */
export function isReferentialFollowup(message: string): boolean {
  const m = message.trim();
  const words = m.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return true;
  return (
    FOLLOWUP_LEAD.test(m) ||
    PRONOUN_VERB.test(m) ||
    PRONOUN_END.test(m) ||
    REFERENTIAL_PHRASE.test(m)
  );
}

// Generic maintenance / comms / control vocabulary. Reused ONLY when present in
// the transcript — this list is a filter over words the technician already said,
// never a source of new equipment facts.
const DOMAIN_TERMS: ReadonlyArray<RegExp> = [
  /ethernet\/?ip/gi, /\bethernet\b/gi, /\bmodbus\b/gi, /\brs-?485\b/gi, /\bdevicenet\b/gi,
  /\bprofibus\b/gi, /\bprofinet\b/gi, /\bdsi\b/gi, /\bkeypad\b/gi, /\bterminal\b/gi,
  /\bparameter\b/gi, /\bdecel\w*\b/gi, /\baccel\w*\b/gi, /\bspeed\s+reference\b/gi,
  /\bpreset\b/gi, /\bfault\b/gi, /\bautotune\b/gi, /\bcomm\w*\b/gi, /\bnetwork\b/gi,
];

/** Extract the salient, reusable tokens from a turn: exact IDs (param/fault/
 *  catalog numbers) + any domain vocabulary the turn actually contains. */
function salientTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (tok: string) => {
    const k = tok.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(tok);
    }
  };
  for (const re of EXACT_PATTERNS) for (const m of text.matchAll(re)) push(m[0]);
  for (const re of DOMAIN_TERMS) for (const m of text.matchAll(re)) push(m[0]);
  return out;
}

/** Build the retrieval query for a possibly-referential follow-up. Self-contained
 *  questions are returned unchanged; a referential follow-up is augmented with the
 *  salient tokens from the most recent turns that it does not already mention, so
 *  BM25 has the thread's subject to match. Current message stays FIRST so it
 *  dominates ranking. Deterministic + pure. */
export function buildRetrievalQuery(message: string, history: ChatHistoryTurn[]): string {
  const msg = message.trim();
  if (history.length === 0 || !isReferentialFollowup(msg)) return msg;
  const lower = msg.toLowerCase();
  const added: string[] = [];
  const seen = new Set<string>();
  for (const t of history.slice(-4)) {
    for (const tok of salientTokens(t.content)) {
      const k = tok.toLowerCase();
      if (lower.includes(k) || seen.has(k)) continue;
      seen.add(k);
      added.push(tok);
      if (added.length >= 6) break;
    }
    if (added.length >= 6) break;
  }
  return added.length ? `${msg} ${added.join(" ")}` : msg;
}

// ---------------------------------------------------------------------------
// Broad / enumeration intent + facet fan-out
//
// A broad question ("what communication options does this drive have?", "what
// are all the ways I can command speed?", "what protections does it have?")
// fails single-cluster retrieval: the reranker floats ONE matching section to
// the top and the answer treats it as exhaustive — so the PF525 answer listed
// only the optional adapter table and MISSED embedded EtherNet/IP + embedded
// Modbus that the same manual proves on other pages. The fix is (a) recognize
// broad intent, (b) fan retrieval out across the GENERIC facet vocabulary of the
// family so scattered facets all reach the pool, and (c) diversify by page so no
// single section eats every slot. The facet terms are generic industrial
// vocabulary used only to RETRIEVE — the answer still cites, and lists an option
// only if an excerpt proves it (same discipline as the synonym expansion above).
// ---------------------------------------------------------------------------

type FacetFamily = { re: RegExp; key: string; facets: readonly string[] };

const FACET_FAMILIES: readonly FacetFamily[] = [
  {
    re: /\b(communicat\w*|comms?|network\w*|fieldbus|protocol|talk to|connect (?:it )?to (?:a )?(?:plc|controller))\b/i,
    key: "comm",
    facets: [
      "embedded EtherNet/IP", "RS-485 Modbus RTU", "DSI serial",
      "communication adapter", "DeviceNet", "PROFIBUS", "PROFINET",
    ],
  },
  {
    re: /\b(command (?:the )?speed|control (?:the )?speed|speed (?:reference|command|source)|frequency reference|ways .* speed|speed .* (?:source|command))\b/i,
    key: "speed",
    facets: [
      "keypad frequency", "potentiometer", "preset frequency",
      "analog input", "network reference", "MOP", "speed reference select",
    ],
  },
  {
    re: /\b(protection|protect\w*|trip\w*|safety feature|fault protection)\b/i,
    key: "protection",
    facets: [
      "overcurrent", "overvoltage", "undervoltage", "motor overload",
      "ground fault", "short circuit", "thermal", "stall",
    ],
  },
];

// Generic enumeration phrasing that isn't tied to a known family.
const BROAD_ENUM =
  /\b(what (?:are\s+)?(?:all\s+)?(?:the\s+)?(?:different\s+)?(?:ways|options|methods|choices|kinds|types)|all the ways|how many (?:ways|options)|what \w+ (?:options|methods|protections|features|inputs|modes)|set ?up (?:the )?communicat)/i;

export type BroadIntent = { broad: boolean; key: string | null; facets: string[] };

/** Detect a broad/enumeration question and, when it belongs to a known family,
 *  return the generic facet vocabulary to fan retrieval out across. */
export function classifyBroad(query: string): BroadIntent {
  const fam = FACET_FAMILIES.find((f) => f.re.test(query));
  const broad = Boolean(fam) || BROAD_ENUM.test(query);
  return { broad, key: fam?.key ?? null, facets: fam ? [...fam.facets] : [] };
}

/** Cap how many chunks may come from the same (doc, page) so one section can't
 *  fill the whole context on a broad question — distinct facets on other pages
 *  get slots. Preserves the incoming (reranked) order; backfills from the capped
 *  overflow if pages are few, so a narrow corpus is never starved. */
export function diversifyByPage<T extends { docId: string | null; sourcePage: number | null }>(
  chunks: T[],
  perPageCap: number,
  limit: number,
): T[] {
  const count = new Map<string, number>();
  const kept: T[] = [];
  const overflow: T[] = [];
  for (const c of chunks) {
    const k = `${c.docId}|${c.sourcePage ?? "?"}`;
    const n = count.get(k) ?? 0;
    if (n < perPageCap) {
      count.set(k, n + 1);
      kept.push(c);
    } else {
      overflow.push(c);
    }
    if (kept.length >= limit) return kept.slice(0, limit);
  }
  for (const c of overflow) {
    if (kept.length >= limit) break;
    kept.push(c);
  }
  return kept.slice(0, limit);
}
