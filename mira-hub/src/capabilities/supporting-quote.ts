/**
 * Answer-aware citation quotes (#4315, design rev 4 §12).
 *
 * A citation `[n]` names a (document, page), and every retrieved chunk of that page
 * reaches the model labelled `[n]` (#1912). The persisted quote used to come from the
 * page's FIRST chunk, windowed by QUESTION words — so a numeric answer ("1.76–2.16 N·m
 * [2]") could ship a proof quote that does not contain the value (staging turn
 * ca12abb8: the value chunk was retrieved, the Fuses/Wiring chunk was quoted).
 *
 * Here every numeric value in the ANSWER is assigned to the nearest citation marker in
 * its region (sentence / whole table row / list item). A citation's quote is the window,
 * across ALL model-visible chunks of its page, holding the most of ITS values, matched on
 * number AND unit. Nothing matches ⇒ the citation keeps today's quote untouched.
 * Deterministic and zero-token: no model call.
 */
import { claimIdentifiers } from "@/lib/quote-window";

/** manual-rag.ts MAX_CONTENT_CHARS: the prefix of each chunk the model actually sees. */
export const MODEL_VISIBLE_CHARS = 1200;
const SPAN = 240; // relevantQuoteWindow's default span
const MAX_MARKER_DISTANCE = 300;

const UNIT_ALIASES: [RegExp, string][] = [
  [/^n·?-?m$/, "nm"], [/^lb·?-?in$/, "lbin"], [/^lb·?-?ft$/, "lbft"],
  [/^vac$/, "vac"], [/^vdc$/, "vdc"], [/^v$/, "v"], [/^ma$/, "ma"], [/^a$/, "a"], [/^hz$/, "hz"], [/^khz$/, "khz"],
  [/^kw$/, "kw"], [/^hp$/, "hp"], [/^kva$/, "kva"], [/^°c$/, "c"], [/^°f$/, "f"], [/^%$/, "%"],
  [/^mm2$/, "mm2"], [/^mm$/, "mm"], [/^in$/, "in"], [/^awg$/, "awg"], [/^ms$/, "ms"], [/^s$/, "s"],
  [/^rpm$/, "rpm"], [/^bar$/, "bar"], [/^psi$/, "psi"], [/^(?:ohms?|ω)$/, "ohm"],
  // Spelled-out forms of the same units.
  [/^(?:seconds?|secs?)$/, "s"], [/^(?:minutes?|mins?)$/, "min"], [/^(?:hours?|hrs?|h)$/, "h"],
  [/^volts?$/, "v"], [/^(?:amps?|amperes?)$/, "a"], [/^hertz$/, "hz"], [/^percent$/, "%"],
  [/^(?:millimet(?:er|re)s?)$/, "mm"], [/^(?:inch|inches)$/, "in"],
];
// Words that follow a number without being its unit ("525 is", "12 and 13", "12 per shift").
// Any OTHER word after a number is its unit — a known alias above, or kept literally — so an
// explicit unit the parser does not know ("12 kV", "12 cm") can never become a wildcard.
const STOPWORDS =
  "and|or|nor|to|of|at|the|for|is|are|was|were|be|on|per|with|from|by|as|if|not|it|its|this|that|than|then|when|while|each|every|between|into|over|under|after|before|so|but|also|only|plus";
const UNKNOWN_UNIT = `(?!(?:${STOPWORDS})(?![\\p{L}\\d]))[\\p{L}°µ][\\p{L}\\d]*`;
const UNIT_SRC =
  "n\\s*[·\\-]?\\s*m|lb\\s*[·\\-]?\\s*(?:in|ft)|v\\s*(?:ac|dc)|v|ma|a|khz|hz|kw|hp|kva|°c|°f|%|mm2|mm|in|awg|ms|s|rpm|bar|psi|ohms?|ω";
// Thousands separator (1,000) | decimal comma not part of a list on either side (1,76 —
// but neither "10,20" nor "20,30" in 10,20,30) | plain.
const NUM = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|(?<!\\d,)\\d+,\\d{1,2}(?![,\\d])|\\d+(?:\\.\\d+)?";
// A letter, digit or dot right before the number (F004, v1.2), a letter-hyphen code
// (A-20), or a letter/digit right after it (10x) means it is not a value. Each number may
// carry a minus sign, also across spacing or markup ("- 20", "-**20**"): -20 °C is not
// 20 °C, and a range keeps both endpoint signs (-20 to -10). A ± tolerance or a comparator
// is part of the unit, so "±0.5 mm" only ever matches "±0.5 mm" and "<40 °C" only "<40 °C".
const VALUE_RE = new RegExp(
  `(?<![\\p{L}\\d./])((?:[±≤≥]|[<>]=?)\\s*)?(-\\s*)?(?<!\\p{L}-)(${NUM})(?:\\s*(?:-|…|\\.\\.\\.|to)\\s*(-\\s*)?(${NUM}))?(?:\\s*(${UNIT_SRC}|${UNKNOWN_UNIT}))?(?![\\p{L}\\d])`,
  "giu",
);
// Parse completeness: a value is usable only when the parser consumed the WHOLE quantity.
// Anything right after it that extends the quantity — a "/" (A/mm², 12 V/24 V, 1/2 in), "^",
// a superscript, "·" (kW·h), a joined "-word" or "-digit" (V-DC, 400 V-class), a ".digit"
// (1.2.3), or a waveform qualifier after the unit (12 volts DC, 12 V rms, 12 V (AC)) — makes
// the value unusable on both sides: it never supports a claim, and as a claim it is
// counted unsupported. The qualifier set is closed: ac, dc, rms, peak, pk, pk-pk, p-p, pp, avg.
const INCOMPLETE_TAIL =
  /^(?:[ \t]*[/^·⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]|[-.][\p{L}\d]|[ \t]*[-(]?[ \t]*(?:ac|dc|rms|peak|pk-pk|pk|p-p|pp|avg)(?![\p{L}\d]))/u;

/** Same-length normalization: matching runs on this; quotes are cut from the original text. */
export function normalize(s: string): string {
  const chars = [...s];
  return chars
    .map((ch, i) => {
      if ("·•⋅∙・‧".includes(ch)) return "·";
      if ("–—‑‒−".includes(ch)) return "-"; // incl. U+2212 MINUS SIGN
      if ("*_`".includes(ch)) return " "; // inline markdown never separates a number from its unit
      if (ch === "²") return /\p{L}/u.test(chars[i - 1] ?? "") ? "2" : ch; // mm² is mm2; 10² stays a power
      if (ch === "Ω") return "ω";
      if (ch === " " || ch === " " || ch === " ") return " ";
      const lower = ch.toLowerCase();
      return lower.length === ch.length ? lower : ch;
    })
    .join("");
}

/** A known unit's canonical form; any other unit word is kept literally ("raw:kv"). */
function canonUnit(u: string | undefined): string | null {
  if (!u) return null;
  const k = u.toLowerCase().replace(/\s+/g, "");
  for (const [re, canonical] of UNIT_ALIASES) if (re.test(k)) return canonical;
  return `raw:${k}`;
}

/** "1,000" → 1000; "1,76" → 1.76; "1.76" → 1.76. */
function parseNum(raw: string): number {
  return /^\d{1,3}(?:,\d{3})+/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
}

export type Value = { nums: number[]; unit: string | null; start: number; end: number; text: string; complete: boolean };

/** `side` matters for one case only: a sign spaced from its number at the start of a line. */
export function findValues(text: string, side: "answer" | "source"): Value[] {
  const out: Value[] = [];
  const n = normalize(text);
  for (const m of n.matchAll(VALUE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let sign: string | undefined = m[2];
    let complete = !INCOMPLETE_TAIL.test(n.slice(end));
    // Decided on the ORIGINAL text: a sign, then real whitespace, with only indentation before
    // it on its line. U+2212 is always a minus. In the answer, an ASCII "- " there is Markdown
    // list syntax — rendered as a bullet, so the number is unsigned. Anywhere else (source text,
    // or another dash in the answer) it is bullet-or-minus: ambiguous, so the value is unusable.
    const at = start + (m[1]?.length ?? 0);
    if (sign && /\s/.test(text[at + 1] ?? "") && text[at] !== "−" && /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", start - 1) + 1, start))) {
      if (side === "answer" && text[at] === "-") sign = undefined;
      else complete = false;
    }
    const unit = canonUnit(m[6]);
    const prefix = m[1]?.replace(/\s+/g, "").replace("<=", "≤").replace(">=", "≥");
    out.push({
      nums: [
        { sign, raw: m[3] },
        { sign: m[4], raw: m[5] },
      ]
        .filter((x): x is { sign: string | undefined; raw: string } => Boolean(x.raw))
        .map((x) => (x.sign ? -1 : 1) * parseNum(x.raw)),
      unit: prefix ? `${prefix}${unit ?? ""}` : unit,
      start,
      end,
      text: text.slice(start, end),
      complete,
    });
  }
  return out;
}

const MARKER_RE = /\[(\d+)\]/g;

/** Regions: a whole table row; else sentences/list items within a line. A sentence end
 *  followed by a citation marker is not a boundary, so `… N·m. [2]` binds backward. */
function regions(answer: string): [number, number][] {
  const out: [number, number][] = [];
  let lineStart = 0;
  for (const line of answer.split("\n")) {
    const ls = lineStart;
    lineStart += line.length + 1;
    if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // table alignment row
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out.push([ls, ls + line.length]); // the complete row is one region
      continue;
    }
    let s = ls;
    for (const m of line.matchAll(/[.!?](?!\s*\[\d+\])\s+/g)) {
      const idx = m.index ?? 0;
      out.push([s, ls + idx + 1]);
      s = ls + idx + m[0].length;
    }
    out.push([s, ls + line.length]);
  }
  return out;
}

const PAGE_RE = /\b(?:p\.|pp\.|page|pages)\s*$/i;

/** The numeric values the answer assigns to each citation id (nearest marker in region). */
export function assignValues(answer: string, question: string): Map<string, Value[]> {
  const res = new Map<string, Value[]>();
  // "<word> <n>" pairs the QUESTION names ("powerflex 525"): a unitless match is the machine.
  const identity = new Set(
    [...normalize(question).matchAll(/([\p{L}][\p{L}-]*)[\s-]?(\d+)/gu)].map((m) => `${m[1]}|${m[2]}`),
  );
  const masked = answer.replace(MARKER_RE, (m) => " ".repeat(m.length)); // keep offsets
  // Parsed once over the whole answer, so "start of a line" means the real line, not a region.
  const values = findValues(masked, "answer");
  for (const [rs, re] of regions(answer)) {
    const groups: { ids: string[]; start: number; end: number }[] = [];
    for (const m of answer.slice(rs, re).matchAll(/(?:\[\d+\]\s*)+/g)) {
      const at = rs + (m.index ?? 0);
      groups.push({ ids: [...m[0].matchAll(MARKER_RE)].map((x) => x[1]), start: at, end: at + m[0].trimEnd().length });
    }
    if (groups.length === 0) continue;
    for (const v of values) {
      const vs = v.start;
      const ve = v.end;
      if (vs < rs || ve > re) continue;
      const before = normalize(masked.slice(Math.max(rs, vs - 24), vs));
      if (v.unit === null) {
        // "(1)", ordinals — but an incomplete value ("1/2 in") has quantity syntax after it, so it is a claim.
        if (v.complete && v.nums.length === 1 && Number.isInteger(v.nums[0]) && v.nums[0] < 10) continue;
        if (PAGE_RE.test(before)) continue;
        if (/^\s*(?:[-*•]\s+)?$/.test(masked.slice(rs, vs)) && /^[.)]\s/.test(masked.slice(ve, ve + 2))) continue; // "12. "
      }
      // The machine the QUESTION names ("PowerFlex 525", "525 drive", "525-series") is identity,
      // unless the number carries a known unit ("525 V" is a rating).
      if (v.unit === null || v.unit.startsWith("raw:")) {
        const word = before.match(/([\p{L}][\p{L}-]*)[\s-]?$/u)?.[1] ?? "";
        if (word && v.nums.length === 1 && identity.has(`${word}|${v.nums[0]}`)) continue;
        if (/^\s*-?series/i.test(masked.slice(ve, ve + 8))) continue;
      }
      let best: (typeof groups)[number] | null = null;
      let bestD = Infinity;
      for (const g of groups) {
        const d = ve <= g.start ? g.start - ve : vs >= g.end ? vs - g.end : 0;
        // nearest; a tie goes to the FOLLOWING marker (the common "value [n]" style)
        if (d < bestD || (d === bestD && g.start >= ve)) {
          best = g;
          bestD = d;
        }
      }
      if (!best || bestD > MAX_MARKER_DISTANCE) continue;
      for (const id of best.ids) res.set(id, [...(res.get(id) ?? []), v]);
    }
  }
  return res;
}

/** A source value supports a claimed one: same unit when the claim states one, and every
 *  claimed number literally present (a range claim needs both endpoints). */
/** Units must agree exactly — a unitless claim matches only a unitless source value, so
 *  no parse can turn a claim into a wildcard. The one compatibility: a bare V vs VAC/VDC. */
function unitsAgree(claim: string | null, src: string | null): boolean {
  if (claim === src) return true;
  // "24 V" is compatible with "24 VAC"/"24 VDC"; "24 VAC" never supports "24 VDC".
  return (claim === "v" && (src === "vac" || src === "vdc")) || (src === "v" && (claim === "vac" || claim === "vdc"));
}

function satisfies(src: Value, claim: Value): boolean {
  if (!src.complete || !claim.complete) return false; // a partly parsed quantity never matches
  if (!unitsAgree(claim.unit, src.unit)) return false;
  return claim.nums.every((c) => src.nums.some((x) => x === c));
}

export type SupportingQuote = {
  /** null ⇒ no claimed value matched: keep the citation's existing quote (today's behavior). */
  quote: string | null;
  support: "claim" | "partial" | "question_fallback";
  /** Claimed values found nowhere in this citation's model-visible page text. */
  unsupported: string[];
};

export function supportingQuote(
  chunks: readonly string[],
  answer: string,
  citationId: string,
  question: string,
): SupportingQuote {
  const claims = assignValues(answer, question).get(citationId) ?? [];
  if (claims.length === 0 || chunks.length === 0) return { quote: null, support: "question_fallback", unsupported: [] };
  const markerAt = answer.indexOf(`[${citationId}]`);
  const qterms = normalize(question).split(/[^\p{L}\p{N}.]+/u).filter((t) => t.length >= 3);
  const ids = [...claimIdentifiers(question)];
  type Cand = { chunk: number; start: number; covered: number; idHits: number; q: number; prox: number };
  const cands: Cand[] = [];
  const everMatched = new Set<number>();
  chunks.forEach((full, ci) => {
    const text = full.slice(0, MODEL_VISIBLE_CHARS);
    const srcVals = findValues(text, "source");
    for (const sv of srcVals) {
      if (!claims.some((c) => satisfies(sv, c))) continue;
      let start = Math.max(0, Math.min(sv.start - Math.floor(SPAN / 4), text.length - SPAN));
      if (start > 0) {
        const sp = text.indexOf(" ", start);
        if (sp !== -1 && sp - start < 40 && sp < sv.start) start = sp + 1;
      }
      const end = Math.min(text.length, start + SPAN);
      const inWin = srcVals.filter((x) => x.start >= start && x.end <= end);
      const covered = claims.map((c, k) => (inWin.some((x) => satisfies(x, c)) ? k : -1)).filter((k) => k >= 0);
      covered.forEach((k) => everMatched.add(k));
      const win = normalize(text.slice(start, end));
      cands.push({
        chunk: ci,
        start,
        covered: covered.length,
        idHits: ids.filter((t) => win.includes(t)).length,
        q: qterms.filter((t) => win.includes(t)).length,
        prox: Math.min(...covered.map((k) => Math.abs(claims[k].start - markerAt))),
      });
    }
  });
  const unsupported = claims.filter((_, k) => !everMatched.has(k)).map((c) => c.text.trim());
  if (cands.length === 0) return { quote: null, support: "question_fallback", unsupported };
  cands.sort(
    (a, b) =>
      b.covered - a.covered || b.idHits - a.idHits || b.q - a.q || a.prox - b.prox || a.chunk - b.chunk || a.start - b.start,
  );
  const w = cands[0];
  const text = chunks[w.chunk].slice(0, MODEL_VISIBLE_CHARS);
  return {
    quote: (w.start > 0 ? "…" : "") + text.slice(w.start, w.start + SPAN),
    support: w.covered === claims.length ? "claim" : "partial",
    unsupported,
  };
}

type QuotableCitation = { citationId: string; quote: string | null };
type PageChunk = { content: string; sourceUrl: string; sourcePage: number | null };

/**
 * Re-derive each EMITTED citation's quote from the answer. Chunks are grouped exactly as
 * buildCitations numbers them — key `${sourceUrl}::${sourcePage ?? ""}`, citationId =
 * first-appearance order — so [n] here is the same page the model saw as [n]. A citation
 * with no matched claimed value keeps its existing quote byte-for-byte.
 */
export function withSupportingQuotes<C extends QuotableCitation>(
  citations: readonly C[],
  chunks: readonly PageChunk[],
  answer: string,
  question: string,
): { citations: C[]; unsupportedValueCount: number; quoteFallbackCount: number } {
  const byKey = new Map<string, string[]>();
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c.content]);
  }
  const pages = [...byKey.values()]; // citationId n ⇔ pages[n - 1]
  let unsupportedValueCount = 0;
  let quoteFallbackCount = 0;
  const out = citations.map((c) => {
    const pageChunks = pages[Number(c.citationId) - 1];
    if (!pageChunks) return c;
    const r = supportingQuote(pageChunks, answer, c.citationId, question);
    unsupportedValueCount += r.unsupported.length;
    if (r.quote === null) {
      quoteFallbackCount += 1;
      return c;
    }
    return { ...c, quote: r.quote };
  });
  return { citations: out, unsupportedValueCount, quoteFallbackCount };
}
