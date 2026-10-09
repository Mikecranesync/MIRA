/**
 * Answer-aware citation quotes (#4315, design rev 4 §12; value usability rev 5 §14).
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

// Design rev 5 (#4315 §14): a value is usable only when EVERY part of it is recognized. Its
// unit must be in this closed table. Symbols are matched exactly as written — case carries
// meaning (mW ≠ MW, mΩ ≠ MΩ, N·m ≠ nm) — and only unambiguous case variants are listed. A
// spelled-out name matches in any case. An unknown unit, or no unit, makes a value unusable.
// Maps, not object literals: a lookup must never reach an inherited property ("constructor").
const UNIT_SYMBOLS = new Map<string, string>(Object.entries({
  V: "V", v: "V", mV: "mV", kV: "kV", KV: "kV", MV: "MV", Vrms: "Vrms", VRMS: "Vrms",
  VAC: "VAC", Vac: "VAC", "V AC": "VAC", "V ac": "VAC", VDC: "VDC", Vdc: "VDC", "V DC": "VDC", "V dc": "VDC",
  A: "A", mA: "mA", kA: "kA", W: "W", mW: "mW", kW: "kW", KW: "kW", kw: "kW", MW: "MW",
  VA: "VA", kVA: "kVA", KVA: "kVA", kva: "kVA", Hz: "Hz", hz: "Hz", HZ: "Hz", kHz: "kHz", KHz: "kHz", khz: "kHz", MHz: "MHz",
  rpm: "rpm", RPM: "rpm", "°C": "°C", "ºC": "°C", "℃": "°C", "°F": "°F", "ºF": "°F", "℉": "°F", "%": "%",
  "Ω": "Ω", "kΩ": "kΩ", "MΩ": "MΩ", "mΩ": "mΩ", "N·m": "N·m", "N-m": "N·m", Nm: "N·m", "N m": "N·m",
  "lb·in": "lb·in", "lb-in": "lb·in", "lb·ft": "lb·ft", "lb-ft": "lb·ft",
  mm: "mm", cm: "cm", m: "m", km: "km", in: "in", ft: "ft", mm2: "mm²", m2: "m²", AWG: "AWG", awg: "AWG",
  s: "s", ms: "ms", "µs": "µs", min: "min", h: "h", Pa: "Pa", kPa: "kPa", MPa: "MPa", bar: "bar",
  psi: "psi", PSI: "psi", hp: "hp", HP: "hp",
}));
const UNIT_NAMES = new Map<string, string>(Object.entries({
  volt: "V", volts: "V", amp: "A", amps: "A", ampere: "A", amperes: "A", watt: "W", watts: "W",
  kilowatt: "kW", kilowatts: "kW", hertz: "Hz", second: "s", seconds: "s", sec: "s", secs: "s",
  minute: "min", minutes: "min", mins: "min", hour: "h", hours: "h", hr: "h", hrs: "h", percent: "%",
  ohm: "Ω", ohms: "Ω", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm", inch: "in", inches: "in",
}));
/** The table unit a token names, or null. `N · m` and `lb - in` close up before lookup. */
function tableUnit(token: string): string | null {
  const k = token.replace(/\s*([·-])\s*/g, "$1").replace(/\s+/g, " ");
  return UNIT_SYMBOLS.get(k) ?? UNIT_NAMES.get(k.toLowerCase()) ?? null;
}
// Words that follow a number without being its unit ("525 is", "12 and 13", "12 per shift").
// Any OTHER word after a number is taken as its unit, so an explicit unit outside the table
// ("12 furlongs") is captured — and is unusable — rather than silently dropped.
const STOPWORDS =
  "and|or|nor|to|of|at|the|for|is|are|was|were|be|on|per|with|from|by|as|if|not|it|its|this|that|than|then|when|while|each|every|between|into|over|under|after|before|so|but|also|only|plus";
const UNKNOWN_UNIT = `(?!(?:${STOPWORDS})(?![\\p{L}\\d]))[\\p{L}°µ][\\p{L}\\d]*`;
const UNIT_SRC =
  "n[ \\t]*[·\\-]?[ \\t]*m|lb[ \\t]*[·\\-]?[ \\t]*(?:in|ft)|v[ \\t]*(?:ac|dc)|v|ma|a|khz|hz|kw|hp|kva|°c|°f|℃|℉|%|mm2|mm|in|awg|ms|s|rpm|bar|psi|ohms?|ω";
// A number is digits with at most one dot decimal. A comma never joins a number: "1,000",
// "1,76", "0,125" and "12,3456" each read as a thousands group in one locale and a decimal in
// another, so their pieces are fragments — unusable (Codex r6 F10/F11).
const NUM = "\\d+(?:\\.\\d+)?";
// A letter, digit, dot, slash or exponent sign right before the number (F004, v1.2, 1/2, m^2,
// ×10), a letter-hyphen code (A-20), or a letter/digit right after it (10x) means it is not a
// value of its own. Each number may
// carry a minus sign, also across spacing or markup ("- 20", "-**20**"): -20 °C is not
// 20 °C, and a range keeps both endpoint signs (-20 to -10). A ± tolerance or a comparator
// is part of the unit, so "±0.5 mm" only ever matches "±0.5 mm" and "<40 °C" only "<40 °C".
// A value, its range and its unit sit on ONE line: "Step 12" above "A. Remove…" is not 12 A.
const VALUE_RE = new RegExp(
  `(?<![\\p{L}\\d./^×])((?:[±≤≥]|[<>]=?)[ \\t]*)?(-[ \\t]*)?(?<!\\p{L}-)(${NUM})(?:[ \\t]*(?:-|…|\\.\\.\\.|to)[ \\t]*(-[ \\t]*)?(${NUM}))?(?:[ \\t]*(${UNIT_SRC}|${UNKNOWN_UNIT}))?(?![\\p{L}\\d])`,
  "giu",
);
// What follows a value must not continue the quantity. A "/" (A/mm², 12 V/24 V, 1/2 in), "^",
// "×", "±" (12 V ±5%), an AC/DC mark ("~", "⎓", "="), a superscript or subscript, "·" (kW·h), a joined
// "-word" (V-DC, 400 V-class), any punctuation then a digit (1.2.3, 10,20, 12:30), or a waveform qualifier
// (12 volts DC, 12 V rms, 12 V (AC)) makes the value unusable. The qualifier set is closed:
// ac, dc, a.c., d.c., rms, r.m.s., peak, pk, pk-pk, p-p, pp, avg.
const INCOMPLETE_TAIL =
  /^(?:[ \t]*[/^×±~⎓=·⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉]|[-.,]\p{L}|[^\s\p{L}\d]\d|[ \t]*[-(]?[ \t]*(?:ac|dc|a\.c\.|d\.c\.|rms|r\.m\.s\.|peak|pk-pk|pk|p-p|pp|avg)(?![\p{L}\d]))/u;
// "1.000" / "2.500" is a thousands group in one locale and three decimals in another: unusable.
// A leading zero ("0.125") can only be a decimal.
const AMBIGUOUS_GROUP = /^[1-9]\d{0,2}\.\d{3}$/;

/** Does the text after a value continue its quantity? `tail` is lowercase-normalized,
 *  `tailKeep` the same text with case kept (unit symbols are case-sensitive). */
function continues(tail: string, tailKeep: string): boolean {
  if (INCOMPLETE_TAIL.test(tail)) return true;
  // A second table unit after a space (12 kW h, 12 m s⁻¹). "in" is the one table word that is
  // overwhelmingly the English preposition ("24 V in the cabinet"), so it never continues.
  const word = /^[ \t]+([\p{L}°µΩ%℃℉][\p{L}\d·]*)/u.exec(tailKeep)?.[1];
  return word !== undefined && word !== "in" && tableUnit(word) !== null;
}

/** The next `max` characters from `from`, each run of spaces/tabs collapsed to one space: a run
 *  of any length can neither hide what follows it nor cost backtracking. Linear in the run. */
function tailAt(s: string, from: number, max = 64): string {
  let out = "";
  for (let i = from; i < s.length && out.length < max; i++) {
    const ch = s[i] === "\t" ? " " : s[i];
    if (ch === " " && out.endsWith(" ")) continue;
    out += ch;
  }
  return out;
}

/** Split original GFM cells: an odd backslash run escapes a pipe, an even
 * run does not. Inline normalization must never invent delimiters. */
function originalTableCells(row: string, trimOuter = true): string[] {
  const text = trimOuter ? row.trim() : row;
  const cells: string[] = [];
  let cell = "";
  let slashes = 0;
  for (const char of text) {
    if (char === "|" && slashes % 2 === 0) {
      cells.push(cell);
      cell = "";
    } else cell += char;
    slashes = char === "\\" ? slashes + 1 : 0;
  }
  cells.push(cell);
  if (trimOuter && cells[0] === "") cells.shift();
  if (trimOuter && cells.at(-1) === "") cells.pop();
  return cells;
}

/** Left boundary: is the value at `start` a later piece of one number? It is when a digit
 *  precedes it across same-line spaces/tabs (1 000), a number-joining mark with or without
 *  spaces around it (1,000 / 1 ,000 / 1,**234** / 1:30 / 12 / 24 / 12'6), or any other mark
 *  glued with no space on either side. Brackets, table pipes and a sentence's ". " are not
 *  joins, so "mm2 (10 AWG)", "| 5 | 3.09 N·m" and "Step 1. 12 V" stay separate values. The
 *  leading piece is unitless or followed by a joint, so it is unusable too. */
function laterPieceOfNumber(n: string, start: number, original: string): boolean {
  const isWs = (i: number) => n[i] === " " || n[i] === "\t";
  // #4320: screen the WHOLE match, not only its digits. ≈/~ remain the existing
  // approximation decoration; scan opening quotes/brackets too, across inline markup.
  let boundary = start;
  let enclosed = false;
  let cellBoundary = false;
  while (boundary > 0) {
    let at = boundary - 1;
    while (at >= 0 && isWs(at)) at--;
    if (at < 0 || !/[≈~"'“‘([{|]/u.test(n[at])) break;
    enclosed ||= /[([{|]/u.test(n[at]);
    cellBoundary ||= n[at] === "|";
    boundary = at;
  }
  const priorCellUnit = cellBoundary && /\d[ \t]*[%℃℉][ \t]*$/u.test(n.slice(0, boundary));
  const left = n[boundary - 1] ?? "";
  if (left && !priorCellUnit && !/[\s([{|,;:]/u.test(left) && !(enclosed && /\p{L}/u.test(left)) && !(cellBoundary && /\d/u.test(left))) return true;
  let before = boundary;
  while (before > 0 && isWs(before - 1)) before--;
  // Formatting can separate an exponent marker from its signed exponent.
  if (/\d[ \t]*e$/u.test(n.slice(0, before))) return true;
  // Only an original bullet at an indented line start is layout. Markdown +
  // allows at most three leading spaces; code-block indentation is not a list. Normalization
  // merges • with multiplication dots, so the normalized mark is insufficient.
  const listMark = before > 0 && /[•+]/u.test(original[before - 1])
    && /^[\t\p{Zs}]*$/u.test(original.slice(original.lastIndexOf("\n", before - 1) + 1, before - 1))
    && /[\t\p{Zs}]/u.test(original[before] ?? "")
    && (original[before - 1] !== "+" || /^ {0,3}$/u.test(original.slice(original.lastIndexOf("\n", before - 1) + 1, before - 1)));
  const headingMark = before > 0 && original[before - 1] === "#"
    && /^ {0,3}#{1,6}$/.test(original.slice(original.lastIndexOf("\n", before - 1) + 1, before))
    && /[ \t]/.test(original[before] ?? "");
  // Markdown normalizes to spaces: ≠ **0** / 1e+**3** must not lose a mark.
  if (before < boundary && before > 0 && !listMark && !headingMark && !priorCellUnit && /[^\p{L}\d()[\]{}|.,;:]/u.test(n[before - 1])) return true;
  // A preceding numeric coefficient is only a separate cell in a real row.
  // Otherwise −2|20 V| is an expression, not a supported plain 20 V quantity.
  // Retain compact rows such as |5|12 V| and the unscaled |12 V| control.
  if (cellBoundary) {
    const lineStart = n.lastIndexOf("\n", boundary - 1) + 1;
    const linePrefix = n.slice(lineStart, boundary);
    if (/\d[ \t]*$/u.test(linePrefix) && !/^[ \t]*\|/u.test(linePrefix)) {
      // GFM also permits tables without outer pipes. Require a contiguous
      // matching header/alignment block, not merely a bar in nearby prose.
      // GFM body rows may have fewer or extra cells; extra cells are ignored.
      const priorCells = originalTableCells(original.slice(lineStart, boundary), false).map(cell => normalize(cell));
      // Keep ambiguous signed prose coefficients conservative while allowing
      // ordinary text or hyphenated model cells (Frame 5, Model A-20).
      if (/\p{L}[^|]*[ \t][+-][ \t]*\d+(?:\.\d*)?[ \t]*$/u.test(priorCells.at(-1) ?? "")) return true;
      const valueCell = originalTableCells(original.slice(lineStart, start), false).length - 1;
      if (valueCell < 1) return true;
      const startsBlock = /^(?: {4}|\t)|^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|(?:[*+-]|\d+[.)])[ \t]+|<(?:[!?]|\/?[A-Za-z])|\[[^\]]+\]:)|^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/;
      if (startsBlock.test(original.slice(lineStart, boundary))) return true;
      // Normalization blanks inline markers, including code-fence backticks.
      // Block syntax must be checked against the same-length original text.
      const originalRows = original.slice(0, lineStart).split("\n").slice(0, -1);
      let tableRow = false;
      for (let row = originalRows.length - 1; row > 0; row--) {
        const cells = originalTableCells(originalRows[row]);
        if (!originalRows[row].trim()) break;
        if (cells.every((cell) => /^[ \t]*:?-+:?[ \t]*$/.test(cell))) {
          const header = originalTableCells(originalRows[row - 1]);
          tableRow = cells.length > 1 && header.length === cells.length && valueCell < header.length && !startsBlock.test(originalRows[row - 1]);
          break;
        }
        // Alignment takes precedence over a one-hyphen list-looking prefix.
        if (startsBlock.test(originalRows[row])) break;
      }
      if (!tableRow) return true;
    }
    return false;
  }
  let k = start;
  while (k > 0 && isWs(k - 1)) k--;
  const spaced = k < start;
  if (k > 0 && /[,:'’/×^]/.test(n[k - 1])) {
    k--;
    while (k > 0 && isWs(k - 1)) k--;
  } else if (k > 0 && !spaced && /[^\s\p{L}\d]/u.test(n[k - 1]) && !isWs(k - 2)) {
    k--;
  }
  return k < start && /\d/.test(n[k - 1] ?? "");
}

/** Same-length normalization: matching runs on this; quotes are cut from the original text.
 *  `keepCase` keeps letter case, for unit lookup. */
export function normalize(s: string, keepCase = false): string {
  const chars = [...s];
  return chars
    .map((ch, i) => {
      if ("·•⋅∙・‧".includes(ch)) return "·";
      if ("–—‑‒−".includes(ch)) return "-"; // incl. U+2212 MINUS SIGN
      if ("*_`".includes(ch)) return " "; // inline markdown never separates a number from its unit
      if (ch === "²") return /\p{L}/u.test(chars[i - 1] ?? "") ? "2" : ch; // mm² is mm2; 10² stays a power
      if (ch === "\u03bc") return "\u00b5"; // Greek mu is the micro sign
      if (ch === "\u2126" || ch === "\u03a9") return keepCase ? "\u03a9" : "\u03c9"; // OHM SIGN is Omega
      if (/\p{Zs}/u.test(ch)) return " "; // every Unicode space: NBSP, thin, narrow NBSP, hair, figure, ideographic…
      if (keepCase) return ch;
      const lower = ch.toLowerCase();
      return lower.length === ch.length ? lower : ch;
    })
    .join("");
}

/** The table unit, `raw:<token>` for a unit outside the table, or null for no unit. */
function canonUnit(u: string | undefined): string | null {
  if (!u) return null;
  return tableUnit(u) ?? `raw:${u}`;
}

/** "1.76" → 1.76 (the grammar admits only digits and one dot). */
function parseNum(raw: string): number {
  return Number(raw);
}

/** `complete`: nothing before or after continues the quantity. `usable`: complete AND its
 *  unit is in the table — only usable values ever support, or are supported. */
export type Value = {
  nums: number[];
  unit: string | null;
  start: number;
  end: number;
  text: string;
  complete: boolean;
  usable: boolean;
};

/** `side` matters for one case only: a sign spaced from its number at the start of a line. */
export function findValues(text: string, side: "answer" | "source"): Value[] {
  const out: Value[] = [];
  const n = normalize(text);
  const keep = normalize(text, true);
  for (const m of n.matchAll(VALUE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let sign: string | undefined = m[2];
    let complete = !continues(tailAt(n, end), tailAt(keep, end)) && !laterPieceOfNumber(n, start, text);
    // Decided on the ORIGINAL text: a sign, then real whitespace, with only indentation before
    // it on its line. U+2212 is always a minus. In the answer, an ASCII "- " there is Markdown
    // list syntax — rendered as a bullet, so the number is unsigned. Anywhere else (source text,
    // or another dash in the answer) it is bullet-or-minus: ambiguous, so the value is unusable.
    const at = start + (m[1]?.length ?? 0);
    if (sign && /\s/.test(text[at + 1] ?? "") && text[at] !== "−" && /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", start - 1) + 1, start))) {
      if (side === "answer" && text[at] === "-") sign = undefined;
      else complete = false;
    }
    // The unit group ends the match, so its case-kept text is the match's last m[6].length chars.
    const unit = canonUnit(m[6] ? keep.slice(end - m[6].length, end) : undefined);
    const prefix = m[1]?.replace(/\s+/g, "").replace("<=", "≤").replace(">=", "≥");
    const parts = [
      { sign, raw: m[3] },
      { sign: m[4], raw: m[5] },
    ].filter((x): x is { sign: string | undefined; raw: string } => Boolean(x.raw));
    if (parts.some((x) => AMBIGUOUS_GROUP.test(x.raw))) complete = false;
    out.push({
      nums: parts.map((x) => (x.sign ? -1 : 1) * parseNum(x.raw)),
      unit: prefix ? `${prefix}${unit ?? ""}` : unit,
      start,
      end,
      text: text.slice(start, end),
      complete,
      usable: complete && unit !== null && !unit.startsWith("raw:"),
    });
  }
  return out;
}

const MARKER_RE = /\[(\d+)\]/g;

/** Regions: a whole table row; else sentences/list items within a line. A sentence end
 *  followed by a citation marker is not a boundary, so `… N·m. [2]` binds backward; nor is a
 *  period followed by a lowercase word (an abbreviation mid-sentence). */
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
    // A lowercase word after the period continues the sentence ("max. per frame", "i.e. the").
    for (const m of line.matchAll(/[.!?](?!\s*\[\d+\])\s+(?![\s\p{Ll}])/gu)) {
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
        // A footnote marker "(1)". Any other unitless number is a claim, and an unusable one: a
        // bare 5 in "between 5 and 10 V" is a voltage read without its unit, never an ordinal.
        if (masked[vs - 1] === "(" && masked[ve] === ")" && v.nums.length === 1 && Number.isInteger(v.nums[0]) && v.nums[0] < 10) continue;
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

/** Units must agree exactly. The one compatibility runs one way: a source "24 VAC"/"24 VDC"
 *  supports a claim of "24 V", but a bare "24 V" never proves a claim that it is AC or DC. */
function unitsAgree(claim: string | null, src: string | null): boolean {
  if (claim === src) return true;
  return claim === "V" && (src === "VAC" || src === "VDC");
}

/** A source value supports a claimed one: both usable, units agree, and every claimed number
 *  literally present (a range claim needs both endpoints). */

function satisfies(src: Value, claim: Value): boolean {
  if (!src.usable || !claim.usable) return false; // a partly recognized quantity never matches
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
      if (covered.length === 0) continue; // the window cannot hold the whole value (Codex r6 F12)
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
