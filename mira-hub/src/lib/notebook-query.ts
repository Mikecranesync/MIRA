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
  [/\b(?:too )?long to stop\b|\bstop(?:ping)?\s*time\b|\btakes? (?:too )?long to stop\b|\bslow to stop\b/i, ["deceleration", "decel time"]],
  [/\bspeed(?:\s|-)?up\b|\bramp\s*up\b|\baccel\w*\b/i, ["acceleration", "accel time"]],
  [/\bramp\b/i, ["accel time", "decel time"]],
  [/\bsecond\s+speed\b|\b2nd\s+speed\b/i, ["speed reference 2", "preset frequency", "start source 2"]],
  [/\bmotor\s+freq\w*\b/i, ["motor np hertz", "nameplate", "maximum freq", "minimum freq", "output freq"]],
  [/\bmotor\s+speed\b/i, ["output freq", "commanded freq", "preset freq"]],
  [/\b(nameplate|name\s*plate)\b/i, ["motor np hertz", "motor np volts", "motor np amps"]],
  [/\bpreset\b/i, ["preset freq"]],
  [/\bterminal\b|\bwire\b|\binput\b/i, ["digin termblk", "terminal block"]],
  // Keypad/panel NAVIGATION questions ("find it on the keypad") share no tokens
  // with the manual's procedure section — bridge to the generic drive-manual
  // vocabulary. Trigger only on navigation phrasing: a bare "keypad" mention
  // ("the keypad works but not from the PLC") is a control-source question and
  // must NOT be flooded with navigation chunks.
  [/\b(?:on|from|via|with|using)\s+the\s+keypad\b|\bfront panel\b/i, ["viewing and editing parameters", "programming menu", "navigation keys"]],
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
  // A specific protocol/fieldbus named in the question is an exact token: the
  // chunk that documents it (often an adapter/accessory table) must surface and
  // dominate, so a "where's the PROFINET setting?" question reaches the evidence
  // that lets MIRA answer or correct the premise instead of blindly abstaining.
  for (const m of q.matchAll(/\b(profinet|profibus|devicenet|ethercat|canopen|bacnet|modbus)\b/gi)) {
    exact.add(m[0].toUpperCase());
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

// ---------------------------------------------------------------------------
// Intent + content-signal ranking features
//
// section_path is NULL on v2 chunks, so we can't rank by heading — we rank by
// the chunk's CONTENT signature. A parameter-index chunk ("Motor NP FLA P034
// Motor NP Poles P035 …", "607 HW Addr 692 EN Subnet(1) …") is dense in
// param-id/number tokens and footnote markers with little prose; a PROCEDURE
// chunk ("The cause must be corrected before the fault can be cleared … ATTENTION")
// is prose + imperatives. When the technician's intent is a procedure / fault /
// comm question, we boost the prose/imperative/comm signal and penalize
// index-density so a param index can't beat an actual how-to on lexical overlap.
// Gated by intent: a param-lookup or spec question does NOT get the index
// penalty (the param chunk IS the answer, and exact-token dominance still holds).
// ---------------------------------------------------------------------------

export type Intent = "param_lookup" | "spec" | "procedure" | "fault" | "comm" | "broad" | "generic";

const PARAM_ID_TOKEN = /\b(?:[PpAaBbCcHhLdtUu]\d{2,4})\b/g; // P034, A410, C124, t082, d380
const FOOTNOTE_MARK = /\(\d\)/g; // "(1)" cross-ref footnote markers dense in index chunks
const PROSE_WORDS =
  /\b(the|a|an|to|of|is|are|be|before|after|when|if|must|should|then|this|that|which|from|with|until|while|because|so)\b/gi;
const PROC_SIGNALS =
  /\b(verify|check|set|press|remove|clear|reset|correct|corrected|apply|turn|ensure|connect|disconnect|measure|inspect|replace|confirm|select|enter|navigate|attention|warning|caution|step|steps|procedure|follow)\b/gi;
const COMM_SIGNALS =
  /\b(ethernet\/ip|ethernet|modbus|rs-?485|profibus|profinet|devicenet|adapter|network|node addr|ip addr|gateway|subnet|comm loss|dsi|rj45|protocol)\b/gi;
// Value-bearing spec material: decimal values ("600.00", "10.00 s") and the
// range/default vocabulary of a parameter detail row — what a spec question
// ("what's the maximum?") actually needs, vs. a name-list index page.
const SPEC_SIGNALS = /\b\d+\.\d+\b|\b(range|default|units?|min\/max)\b/gi;

const wordCount = (t: string) => Math.max(1, t.split(/\s+/).filter(Boolean).length);
const countMatches = (t: string, re: RegExp) => (t.match(re) || []).length;

/** How "parameter-index-like" a chunk reads: high digit/footnote token density,
 *  low prose. 0..~1; high on a cross-reference index, ~0 on a procedure. */
function indexiness(text: string): number {
  const w = wordCount(text);
  const ids = countMatches(text, PARAM_ID_TOKEN) + countMatches(text, FOOTNOTE_MARK);
  const prose = countMatches(text, PROSE_WORDS);
  return ids / w - prose / w; // param-index heavy minus prose-heavy
}
function procedureScore(text: string): number {
  return Math.min(countMatches(text, PROC_SIGNALS), 6) / 6;
}
function commScore(text: string): number {
  return Math.min(countMatches(text, COMM_SIGNALS), 6) / 6;
}

// Protocol families for architecture discrimination: a comm question that NAMES
// a protocol ("how does Ethernet work?") must rank that family's material above
// another family's, or the RS-485/DSI appendix wins on generic comm density and
// the answer describes the wrong architecture (topic-switch T3 defect).
const PROTOCOL_FAMILIES: ReadonlyArray<{ key: string; re: RegExp }> = [
  { key: "ethernet", re: /ethernet(?:\/ip)?|\benet\b|\beip\b/gi },
  { key: "modbus", re: /\bmodbus\b|\brs-?485\b|\bdsi\b/gi },
  { key: "profinet", re: /\bprofinet\b/gi },
  { key: "profibus", re: /\bprofibus\b/gi },
  { key: "devicenet", re: /\bdevicenet\b/gi },
  { key: "canopen", re: /\bcanopen\b/gi },
  { key: "ethercat", re: /\bethercat\b/gi },
  { key: "bacnet", re: /\bbacnet\b/gi },
];

/** The single protocol family a query names, or null (none / more than one —
 *  a multi-protocol question is a survey, not a family-scoped one). */
export function queryProtocolFamily(query: string): { key: string; re: RegExp } | null {
  const hits = PROTOCOL_FAMILIES.filter((f) => {
    f.re.lastIndex = 0;
    return f.re.test(query);
  });
  return hits.length === 1 ? hits[0] : null;
}

function familyScore(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return Math.min(countMatches(text, re), 6) / 6;
}
function specScore(text: string): number {
  return Math.min(countMatches(text, SPEC_SIGNALS), 6) / 6;
}

// Intent detection — deterministic/lexical (the mission's "favor the simplest
// mechanism"). Order matters: fault-action beats generic procedure beats comm
// beats spec beats param-lookup.
const FAULT_ACTION =
  /\b(clear|reset|recover|clears|resets|recovers|clearing|resetting)\b[^.?!]*\b(fault|trip)|\b(fault|trip)\b[^.?!]*\b(clear|reset|recover)|after (?:it|the drive|this) (?:faults|trips)|get (?:it|the drive) running again/i;
const PROCEDURE_LEAD =
  /^(how (?:do|can|to)|how do i|how does one|walk me through|steps to|what(?:'s| is) the (?:procedure|process|sequence))\b|\b(procedure|commission|set ?up|wire|wiring|autotune|navigate|on the keypad)\b/i;
const COMM_TOPIC =
  /\b(communicat\w*|comms?|network\w*|fieldbus|protocol|ethernet|modbus|rs-?485|profibus|profinet|devicenet|adapter|node addr|ip addr|gateway|subnet)\b/i;
const SPEC_TOPIC =
  /\b(max|maximum|min|minimum|range|limit|default|how high|how low|highest|lowest|what value|valid value)\b/i;

/** Classify the query's ranking intent. Composes with classifyBroad (a comm
 *  question can be both comm + broad); this returns the SINGLE ranking lever. */
// "what's the <X> parameter?" / "which parameter …?" asks for a parameter ID —
// even when <X> contains a spec word ("maximum frequency parameter"). Spec's
// value-density boost must not fire there (it floods context with value tables
// and starves the naming row).
const PARAM_ID_REQUEST =
  /\bwhich parameter\b|\bwhat(?:'s| is)?\s+the\b[^.?!]{0,60}\bparameter\b(?![^.?!]{0,30}\bset to\b)/i;

export function classifyIntent(query: string): Intent {
  const q = query.trim();
  if (FAULT_ACTION.test(q)) return "fault";
  if (COMM_TOPIC.test(q)) return "comm";
  if (PROCEDURE_LEAD.test(q)) return "procedure";
  if (PARAM_ID_REQUEST.test(q)) return "param_lookup";
  if (SPEC_TOPIC.test(q)) return "spec";
  if (classifyBroad(q).broad) return "broad";
  if (/\b[PpAaBbCcHhLdtUu]\d{2,4}\b|\bparameter\b|\bwhat does\b/i.test(q)) return "param_lookup";
  return "generic";
}

export type RerankTraceRow = {
  page: number | null;
  base: number;
  score: number;
  exactHit: boolean;
  index: number;
  proc: number;
  comm: number;
};

/**
 * Deterministic rerank of a widened candidate pool. Base = normalized ts_rank +
 * exact-token dominance + phrase/synonym boosts. Then INTENT-gated content
 * features: a procedure/fault question boosts prose+imperative signal and
 * penalizes param-index density; a comm question boosts comm-material and
 * penalizes index density; param-lookup/spec keep exact-token dominance with no
 * index penalty. Pass `opts.trace` to capture per-candidate scoring features.
 */
export function rerankChunks<T extends Rerankable>(
  expanded: ExpandedQuery,
  chunks: T[],
  opts?: { intent?: Intent; trace?: RerankTraceRow[] },
): T[] {
  const exact = expanded.exactTokens.map((t) => t.toLowerCase());
  const phrases = expanded.phrases.map((p) => p.toLowerCase());
  const synTerms = expanded.variants
    .slice(1)
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    // Strip clinging punctuation ("keypad?" → "keypad") or the term can never
    // match chunk text via includes() — message keywords were invisible here.
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9/-]+$/g, ""))
    .filter((w) => w.length > 3);
  const intent = opts?.intent ?? "generic";
  const queryFamily = intent === "comm" ? queryProtocolFamily(expanded.variants[0] ?? "") : null;

  const maxRank = Math.max(1e-6, ...chunks.map((c) => c.rank));
  const scored = chunks.map((c, i) => {
    const text = c.content.toLowerCase();
    let score = (c.rank / maxRank) * 1.0; // 0..1 base
    let exactHit = false;
    // Exact-ID dominance is right when the ID is the SUBJECT (spec/param/fault
    // lookups). On a procedure question the ID is thread context, not the
    // subject — the answering chunk is generic how-to text that often lacks the
    // ID entirely (keypad-navigation defect) — so damp it there.
    const exactWeight = intent === "procedure" ? 0.5 : 3.0;
    for (const t of exact) {
      if (t && text.includes(t)) {
        score += exactWeight; // exact ID present verbatim
        exactHit = true;
      }
    }
    for (const p of phrases) if (p && text.includes(p)) score += 2.0;
    let synHits = 0;
    for (const s of synTerms) if (text.includes(s)) synHits++;
    score += Math.min(synHits, 4) * 0.4;

    // Intent-gated content features.
    const idx = indexiness(c.content);
    const proc = procedureScore(c.content);
    const comm = commScore(c.content);
    if (intent === "fault" || intent === "procedure") {
      score += proc * 2.5;
      score -= Math.max(0, idx) * 2.5; // demote the param index
    } else if (intent === "comm") {
      // A comm question naming ONE protocol family scores the chunk on THAT
      // family's material, so another family's appendix can't win on generic
      // comm density (architecture discrimination). Otherwise generic comm.
      score += (queryFamily ? familyScore(c.content, queryFamily.re) : comm) * 1.8;
      score -= Math.max(0, idx) * 1.5;
    } else if (intent === "spec") {
      // Spec questions want the chunk with the VALUES (range/default/decimals),
      // not the parameter name-list page — no index penalty (a value-dense
      // parameter table IS spec material), just a value-material boost.
      score += specScore(c.content) * 1.5;
    }
    // broad / param_lookup / spec / generic: no index penalty. (Broad already has
    // facet fan-out + page diversity; an index penalty here MEASURABLY regressed
    // "what protections?" — protection evidence lives in fault tables that read
    // as index-like, so penalizing them demoted the answer's own evidence.)

    opts?.trace?.push({ page: c.sourcePage, base: c.rank, score, exactHit, index: idx, proc, comm });
    return { c, score, exactHit, i };
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  if (opts?.trace) opts.trace.sort((a, b) => b.score - a.score);
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
// Default window: 12 turns (6 exchanges). At 6 turns a 5-topic conversation's
// opening topic fell out of the window entirely, so "go back to that first
// setting" was unanswerable by construction (adv-5topic T7).
export function sanitizeHistory(raw: unknown, maxTurns = 12, maxChars = 2000): ChatHistoryTurn[] {
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
// Pronoun as SUBJECT before a verb/aux: "what should THAT be set to?", "does IT fault?".
const PRONOUN_VERB = new RegExp(
  `\\b${PRONOUN}\\s+(?:is|are|was|were|be|been|mean|means|do|does|did|should|would|will|wo|can|could|go|goes|work|works|change|changes|set|fault|faults|help)\\b`,
  "i",
);
// Pronoun as OBJECT of a transitive verb: "SET that", "CHANGE it", "RAISE that",
// "turn IT" — the case that was missing ("what's the max I can set that to?").
const PRONOUN_VERB_OBJECT = new RegExp(
  `\\b(?:set|sets|change|changes|raise|lower|adjust|increase|decrease|make|leave|check|find|use|fix|reset|read|enter|configure|program|bump|turn|do)\\s+(?:the\\s+)?${PRONOUN}\\b`,
  "i",
);
// Pronoun trailed by a directional/target particle: "set that TO", "turn it UP".
const PRONOUN_PREP = new RegExp(`\\b${PRONOUN}\\s+(?:to|too|for|up|down)\\b`, "i");
const PRONOUN_END = new RegExp(`\\b${PRONOUN}\\b[\\s?.!,'’]*$`, "i");
const REFERENTIAL_PHRASE = /\b(the other|the same|another|that one|this one|the previous|like that)\b/i;
// Ordinal / sequence continuation with no explicit pronoun: "what do I set
// FIRST?", "what's NEXT?", "AFTER THAT?" — only meaningful mid-conversation
// (buildRetrievalQuery no-ops when there's no history), so safe to include.
const SEQUENCE_CONT = /\b(first|next|after that|before that)\b/i;

/** A short or genuinely referential message ("the other one", "what about
 *  Ethernet?", "what should that be set to?", "what's the max I can set that
 *  to?") needs conversational context to retrieve well; a long self-contained
 *  question ("...on this drive?") does not. A bare "this/that" as a determiner
 *  ("this drive") is deliberately NOT referential — only pronoun uses are. */
export function isReferentialFollowup(message: string): boolean {
  const m = message.trim();
  const words = m.split(/\s+/).filter(Boolean);
  if (words.length <= 5) return true;
  return (
    FOLLOWUP_LEAD.test(m) ||
    PRONOUN_VERB.test(m) ||
    PRONOUN_VERB_OBJECT.test(m) ||
    PRONOUN_PREP.test(m) ||
    PRONOUN_END.test(m) ||
    REFERENTIAL_PHRASE.test(m) ||
    SEQUENCE_CONT.test(m)
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

// Vocabulary too generic to define a topic on its own — "what parameter changes
// first?" must not topic-match every parameter turn in the thread.
const GENERIC_TOPIC_TERMS = new Set(["parameter"]);

/** Topic-defining tokens of a message: exact IDs + domain vocabulary, minus the
 *  generic terms that appear in nearly every drive question. */
function topicTerms(text: string): string[] {
  return salientTokens(text).filter((t) => !GENERIC_TOPIC_TERMS.has(t.toLowerCase()));
}

/** The history turns a referential follow-up should draw context from.
 *  A follow-up that NAMES its topic ("go back to that decel setting") draws only
 *  from the turns about that topic — anywhere in the thread — because the
 *  intervening topic's tokens pollute retrieval (battery defect A: the Ethernet
 *  turns buried the decel default). A bare referential follow-up ("what's the
 *  maximum?") draws from the most recent turns, as before. A message with a
 *  pronoun used AS a pronoun ("where do I find IT on the keypad?") also keeps
 *  the recent turns — the pronoun's referent lives in the thread, and a named
 *  noun ("keypad") is the question's surface, not the referent. */
function topicPool(message: string, history: ChatHistoryTurn[]): ChatHistoryTurn[] {
  const named = topicTerms(message).map((t) => t.toLowerCase());
  // A message that NAMES a topic defines its own subject — even when it also
  // carries a deictic ("how do I set up Ethernet on THIS?", where "this" is
  // the drive, not the thread). The named topic wins; pronoun-driven recency
  // augmentation applies only to messages with no topic terms of their own.
  if (!named.length) {
    // "Go back to that FIRST setting we talked about" — an ordinal return to
    // the conversation's earliest topic. Requires BOTH a return signal and the
    // ordinal, so a step-order question ("what do I set first?") stays on the
    // current topic.
    const ordinalReturn =
      /\b(go back|back to|talked about|discussed|earlier|at the (start|beginning))\b/i.test(message) &&
      /\b(first|original|beginning)\b/i.test(message);
    if (ordinalReturn) {
      for (let i = 0; i < history.length; i++) {
        if (history[i].role === "user" && topicTerms(history[i].content).length) {
          return history.slice(i, i + 2); // that topic's user turn + its answer
        }
      }
    }
    // Bare/pronoun referent = the CURRENT topic. Take the most recent topic
    // segment — from the latest user turn that introduced topic terms onward —
    // so a follow-up after a topic switch ("does that require an adapter?")
    // doesn't drag the pre-switch topic's tokens into retrieval (T4 defect:
    // decel tokens polluted an Ethernet question). Fall back to the recency
    // window when no user turn names a topic.
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user" && topicTerms(history[i].content).length) {
        return history.slice(i);
      }
    }
    return history.slice(-4);
  }
  return history.filter((t) => {
    const turnLower = t.content.toLowerCase();
    return named.some((k) => turnLower.includes(k));
  });
}

/** Build the retrieval query for a possibly-referential follow-up. Self-contained
 *  questions are returned unchanged; a referential follow-up is augmented with the
 *  salient tokens from its topic pool (see topicPool) that it does not already
 *  mention, so BM25 has the thread's subject to match. Current message stays FIRST
 *  so it dominates ranking. Deterministic + pure. */
export function buildRetrievalQuery(message: string, history: ChatHistoryTurn[]): string {
  const msg = message.trim();
  if (history.length === 0 || !isReferentialFollowup(msg)) return msg;
  const lower = msg.toLowerCase();
  const added: string[] = [];
  const seen = new Set<string>();
  for (const t of topicPool(msg, history)) {
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

/** Deterministic topic hint for the SYSTEM prompt. When the current message is a
 *  referential follow-up, name the thread tokens its pronouns/ellipses resolve
 *  against, so the model doesn't resolve an elliptical question to a lexically
 *  similar but off-topic row (battery defect D: "what's the maximum?" in a decel
 *  thread answered P044 [Maximum Freq] instead of P042's maximum). Reuses ONLY
 *  tokens already present in the transcript — never a source of equipment facts.
 *  Returns "" for a self-contained question or an empty thread. */
export function buildTopicHint(message: string, history: ChatHistoryTurn[]): string {
  const msg = message.trim();
  if (history.length === 0 || !isReferentialFollowup(msg)) return "";
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of topicPool(msg, history)) {
    for (const tok of salientTokens(t.content)) {
      const k = tok.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      tokens.push(tok);
      if (tokens.length >= 6) break;
    }
    if (tokens.length >= 6) break;
  }
  if (!tokens.length) return "";
  return (
    `(SYSTEM NOTE — this question is a follow-up in an ongoing conversation about: ` +
    `${tokens.join(", ")}. Resolve pronouns and elliptical phrasing against that topic. An ` +
    `elliptical attribute question — e.g. "what's the maximum?", "what's the default?" — asks ` +
    `for that attribute OF the topic (such as the maximum allowed value of the topic parameter), ` +
    `NOT for a different row or parameter whose name happens to contain that word.)`
  );
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

/** Generic comm-facet vocabulary — used both for a broad "what comm options?"
 *  fan-out AND a specific comm question ("where's the Profinet setting?"), so
 *  scattered comm material (embedded params on one page, the adapter table on
 *  another) all reaches the candidate pool. Retrieval hints only; never asserted. */
export const COMM_FACETS: readonly string[] = [
  "embedded EtherNet/IP", "RS-485 Modbus RTU", "DSI serial",
  "communication adapter", "DeviceNet", "PROFIBUS", "PROFINET",
];

const FACET_FAMILIES: readonly FacetFamily[] = [
  {
    re: /\b(communicat\w*|comms?|network\w*|fieldbus|protocol|talk to|connect (?:it )?to (?:a )?(?:plc|controller))\b/i,
    key: "comm",
    facets: COMM_FACETS,
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

// ---------------------------------------------------------------------------
// Coverage planning (answer-shape classification)
//
// A broad question is not answered by the single best passage — the answer
// SHAPE determines how much evidence the answer owes. The planner classifies
// the question; multi_facet/exhaustive shapes carry an evidence plan (the
// family's facet vocabulary) that retrieval fans out across and generation
// must cover-or-declare-gap. Coverage and groundedness are separate axes: an
// answer can be 100% grounded and still 40% complete.
// ---------------------------------------------------------------------------

export type CoverageShape = "single_fact" | "procedure" | "comparison" | "multi_facet" | "exhaustive";
export type CoveragePlan = { shape: CoverageShape; facets: string[] };

const COMPARISON_SHAPE = /\bdifference between\b|\bcompare\b|\bversus\b|\bvs\.?\b/i;
const EXHAUSTIVE_SHAPE =
  /\b(?:all|every)\b[\s\S]{0,40}\b(?:ways|options|methods|parameters|types|kinds|features|protections)\b|\blist (?:all|every)\b/i;

/** Classify the answer shape a question demands. multi_facet / exhaustive
 *  return the known family's facet plan (empty for generic enumerations —
 *  retrieval then relies on the plain broad path). */
export function classifyCoverage(query: string): CoveragePlan {
  const q = query.trim();
  if (COMPARISON_SHAPE.test(q)) return { shape: "comparison", facets: [] };
  const broad = classifyBroad(q);
  // Exhaustive phrasing counts even outside the known families ("list every
  // parameter") — those get an honest-scope answer, not silent single-passage.
  if (EXHAUSTIVE_SHAPE.test(q)) return { shape: "exhaustive", facets: broad.facets };
  if (broad.broad) return { shape: "multi_facet", facets: broad.facets };
  if (classifyIntent(q) === "procedure") return { shape: "procedure", facets: [] };
  return { shape: "single_fact", facets: [] };
}

// Facet → content matcher. The facet phrases are OUR vocabulary (FACET_FAMILIES),
// so tricky ones get explicit regexes; the default requires every significant
// word's stem. Used for (a) facet-guaranteed slots and (b) the evidence map.
const FACET_MATCHERS: Record<string, RegExp> = {
  "embedded EtherNet/IP": /embedded[\s\S]{0,40}ethernet|emb enet/i,
  "RS-485 Modbus RTU": /rs-?485|modbus rtu|\bdsi\b/i,
  "DSI serial": /\bdsi\b/i,
  "communication adapter": /communication adapter|25-comm/i,
  "keypad frequency": /keypad freq|drive pot|potentiometer/i,
  "analog input": /analog in|0-10 ?v|4-20 ?ma/i,
  "network reference": /network reference|comm freq|network opt|ethernet\/ip reference/i,
  "speed reference select": /speed reference|p04[79]|p051/i,
  "preset frequency": /preset freq/i,
  "motor overload": /motor overload|\boverload\b/i,
  "short circuit": /short circuit/i,
  thermal: /thermal|heatsink|over ?temperature/i,
  stall: /\bstall\b/i,
};

function facetMatcher(term: string): RegExp {
  const explicit = FACET_MATCHERS[term];
  if (explicit) return explicit;
  const stems = term
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(stems.join("[\\s\\S]{0,30}"), "i");
}

type FacetChunk = { content: string; sourcePage: number | null; docId?: string | null };

/** Guarantee every planned facet with pool evidence is represented in the
 *  selected slice — the completeness gap in one line: rerank picks the BEST
 *  chunks overall, so three overload chunks beat one overcurrent chunk and a
 *  whole protection family goes missing. Appends (order-preserving) the best
 *  pool chunk for each unrepresented facet; facets with no pool evidence add
 *  nothing (the gap is then generation's to declare, never to invent). */
export function ensureFacetRepresentation<T extends FacetChunk>(
  selected: T[],
  pool: T[],
  facets: string[],
): T[] {
  const out = [...selected];
  for (const f of facets) {
    const re = facetMatcher(f);
    if (out.some((c) => re.test(c.content))) continue;
    const candidate = pool.find((c) => re.test(c.content));
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** Evidence-map provenance: facet → pages of the selected chunks that prove it
 *  (content-matched). An empty list is an explicit GAP the answer must declare. */
export function facetEvidencePages(chunks: FacetChunk[], facets: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const f of facets) {
    const re = facetMatcher(f);
    const pages: number[] = [];
    for (const c of chunks) {
      if (re.test(c.content) && c.sourcePage != null && !pages.includes(c.sourcePage)) {
        pages.push(c.sourcePage);
      }
    }
    map.set(f, pages);
  }
  return map;
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
