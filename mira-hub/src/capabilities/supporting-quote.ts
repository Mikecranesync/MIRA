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
];
const UNIT_SRC =
  "n\\s*[·\\-]?\\s*m|lb\\s*[·\\-]?\\s*(?:in|ft)|v\\s*(?:ac|dc)|v|ma|a|khz|hz|kw|hp|kva|°c|°f|%|mm2|mm|in|awg|ms|s|rpm|bar|psi|ohms?|ω";
// Thousands separator (1,000) | decimal comma not part of a list on either side (1,76 —
// but neither "10,20" nor "20,30" in 10,20,30) | plain.
const NUM = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|(?<!\\d,)\\d+,\\d{1,2}(?![,\\d])|\\d+(?:\\.\\d+)?";
// A letter, digit or dot right before the number (F004, v1.2) or a letter/digit right
// after it (10x) means it is not a value. Each number may carry a minus sign: -20 °C is
// not 20 °C, and a range keeps both endpoint signs (-20 to -10).
const VALUE_RE = new RegExp(
  `(?<![\\p{L}\\d.])(-?)(${NUM})(?:\\s*(?:-|…|\\.\\.\\.|to)\\s*(-?)(${NUM}))?(?:\\s*(${UNIT_SRC}))?(?![\\p{L}\\d])`,
  "giu",
);

/** Same-length normalization: matching runs on this; quotes are cut from the original text. */
export function normalize(s: string): string {
  return [...s]
    .map((ch) => {
      if ("·•⋅∙・‧".includes(ch)) return "·";
      if ("–—‑‒−".includes(ch)) return "-"; // incl. U+2212 MINUS SIGN
      if ("*_`".includes(ch)) return " "; // inline markdown never separates a number from its unit
      if (ch === "²") return "2";
      if (ch === "Ω") return "ω";
      if (ch === " " || ch === " " || ch === " ") return " ";
      const lower = ch.toLowerCase();
      return lower.length === ch.length ? lower : ch;
    })
    .join("");
}

function canonUnit(u: string | undefined): string | null {
  if (!u) return null;
  const k = u.toLowerCase().replace(/\s+/g, "");
  for (const [re, canonical] of UNIT_ALIASES) if (re.test(k)) return canonical;
  return null;
}

/** "1,000" → 1000; "1,76" → 1.76; "1.76" → 1.76. */
function parseNum(raw: string): number {
  return /^\d{1,3}(?:,\d{3})+/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
}

export type Value = { nums: number[]; unit: string | null; start: number; end: number; text: string };

export function findValues(text: string): Value[] {
  const out: Value[] = [];
  for (const m of normalize(text).matchAll(VALUE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    out.push({
      nums: [
        { sign: m[1], raw: m[2] },
        { sign: m[3], raw: m[4] },
      ]
        .filter((n): n is { sign: string; raw: string } => Boolean(n.raw))
        .map((n) => (n.sign === "-" ? -1 : 1) * parseNum(n.raw)),
      unit: canonUnit(m[5]),
      start,
      end,
      text: text.slice(start, end),
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
  for (const [rs, re] of regions(answer)) {
    const groups: { ids: string[]; start: number; end: number }[] = [];
    for (const m of answer.slice(rs, re).matchAll(/(?:\[\d+\]\s*)+/g)) {
      const at = rs + (m.index ?? 0);
      groups.push({ ids: [...m[0].matchAll(MARKER_RE)].map((x) => x[1]), start: at, end: at + m[0].trimEnd().length });
    }
    if (groups.length === 0) continue;
    for (const v of findValues(masked.slice(rs, re))) {
      const vs = rs + v.start;
      const ve = rs + v.end;
      if (v.unit === null) {
        const before = normalize(masked.slice(Math.max(rs, vs - 24), vs));
        if (v.nums.length === 1 && Number.isInteger(v.nums[0]) && v.nums[0] < 10) continue; // "(1)", ordinals
        if (PAGE_RE.test(before)) continue;
        if (/^\s*(?:[-*•]\s+)?$/.test(masked.slice(rs, vs)) && /^[.)]\s/.test(masked.slice(ve, ve + 2))) continue; // "12. "
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
      for (const id of best.ids) res.set(id, [...(res.get(id) ?? []), { ...v, start: vs, end: ve }]);
    }
  }
  return res;
}

/** A source value supports a claimed one: same unit when the claim states one, and every
 *  claimed number literally present (a range claim needs both endpoints). */
function unitsAgree(claim: string | null, src: string | null): boolean {
  if (claim === null || claim === src) return true;
  // "24 V" is compatible with "24 VAC"/"24 VDC"; "24 VAC" never supports "24 VDC".
  return (claim === "v" && (src === "vac" || src === "vdc")) || (src === "v" && (claim === "vac" || claim === "vdc"));
}

function satisfies(src: Value, claim: Value): boolean {
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
    const srcVals = findValues(text);
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
