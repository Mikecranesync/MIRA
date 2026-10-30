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
import { appearsVerbatim, identifierAt, tableUnit } from "./numeric-support";
import { MAX_CONTENT_CHARS } from "./provider-visible-text";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

/** manual-rag's MAX_CONTENT_CHARS (provider-visible-text.ts): the prefix of each chunk the model
 *  actually sees. One constant, not a copy. */
export const MODEL_VISIBLE_CHARS = MAX_CONTENT_CHARS;
/** The chunk text the provider sees, as a function the caller supplies. Production passes manual-rag's
 *  `providerVisibleChunkText` (cut + ellipsis + reference neutralization — #4981 Codex r2 F2); the
 *  default is the bare MODEL_VISIBLE_CHARS cut for pure callers and tests. */
export type VisibleText = (content: string) => string;
const modelVisiblePrefix: VisibleText = (content) => content.slice(0, MODEL_VISIBLE_CHARS);
const SPAN = 240; // relevantQuoteWindow's default span
const MAX_MARKER_DISTANCE = 300;

// The unit table (design rev 5, #4315 §14) lives in numeric-support.ts, shared with the anomaly
// detector's unit-claim check (#4870).
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
function laterPieceOfNumber(n: string, start: number, original: string, tableCells: ReadonlyArray<readonly [number, number]>, tables: ReadonlyArray<readonly [number, number]>, htmlBlockRows: ReadonlySet<number>, sourceRows: readonly string[], sourceOffsets: readonly number[]): boolean {
  // A GFM row may have ignored extra cells, regardless of its leading pipe.
  // Quantities inside the table must belong to a cell the parser actually kept.
  if (tables.some(([from, to]) => start >= from && start < to)
    && !tableCells.some(([from, to]) => start >= from && start < to)) return true;
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
  const priorCellUnit = cellBoundary && /\d[ \t]*[%℃℉][ \t]*$/u.test(n.slice(0, boundary))
    && tables.some(([from, to]) => start >= from && start < to)
    && tableCells.some(([from, to]) => start >= from && start < to);
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
    && /^[\t\p{Zs}]*$/u.test(original.slice(Math.max(original.lastIndexOf("\n", before - 1), original.lastIndexOf("\r", before - 1)) + 1, before - 1))
    && /[\t\p{Zs}]/u.test(original[before] ?? "")
    && (original[before - 1] !== "+" || /^ {0,3}$/u.test(original.slice(Math.max(original.lastIndexOf("\n", before - 1), original.lastIndexOf("\r", before - 1)) + 1, before - 1)));
  const headingMark = before > 0 && original[before - 1] === "#"
    && /^ {0,3}#{1,6}$/.test(original.slice(Math.max(original.lastIndexOf("\n", before - 1), original.lastIndexOf("\r", before - 1)) + 1, before))
    && /[ \t]/.test(original[before] ?? "");
  // Markdown normalizes to spaces: ≠ **0** / 1e+**3** must not lose a mark.
  if (before < boundary && before > 0 && !listMark && !headingMark && !priorCellUnit && /[^\s\p{L}\d()[\]{}|.,;:]/u.test(n[before - 1])) return true;
  // A preceding numeric coefficient is only a separate cell in a real row.
  // Otherwise −2|20 V| is an expression, not a supported plain 20 V quantity.
  // Retain compact rows such as |5|12 V| and the unscaled |12 V| control.
  if (cellBoundary) {
    const lineStart = Math.max(n.lastIndexOf("\n", boundary - 1), n.lastIndexOf("\r", boundary - 1)) + 1;
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
      const table = tables.find(([from, to]) => start >= from && start < to);
      const inCell = tableCells.some(([from, to]) => start >= from && start < to);
      if (!table || !inCell) return true;
      // Data-cell positions begin after the parsed quote/list prefix. Inspect
      // block syntax relative to that container, not physical indentation.
      const contentStart = (from: number, to: number) => tableCells.find(([cellFrom]) => cellFrom >= from && cellFrom < to)?.[0] ?? from;
      if (startsBlock.test(original.slice(contentStart(lineStart, start), boundary))) return true;
      // Normalization blanks inline markers, including code-fence backticks.
      // Block syntax must be checked against the same-length original text.
      const currentRow = sourceOffsets.indexOf(lineStart);
      const headerRow = sourceOffsets.findIndex((from, index) => table[0] >= from
        && (index + 1 === sourceOffsets.length || table[0] < sourceOffsets[index + 1]));
      if (currentRow < 0 || headerRow < 0) return true;
      // Include the header/delimiter even when the quantity is in a header.
      const originalRows = sourceRows.slice(0, Math.max(currentRow, headerRow + 2));
      // A delimiter/header pair is only layout outside enclosing literal
      // blocks. Scan original lines forward before the backward table search;
      // otherwise a nearer delimiter hides its opening fence or HTML block.
      const blockedRows: boolean[] = [];
      const lazyListRows: boolean[] = [];
      let fence: { mark: string; width: number; indent: number } | null = null;
      let htmlEnd: RegExp | null = null;
      let htmlUntilBlank = false;
      let htmlIndent = 0;
      const listIndents: number[] = [];
      let listParagraph = false;
      for (const [rowIndex, row] of originalRows.entries()) {
        const leading = /^[ \t]*/.exec(row)?.[0] ?? "";
        const leadingIndent = [...leading].reduce((column, char) => char === "\t" ? column + 4 - column % 4 : column + 1, 0);
        // A literal block cannot outlive its list container. Blank lines may
        // remain inside it; a nonblank outdent is reprocessed in its new scope.
        if (row.trim() && (fence && leadingIndent < fence.indent
          || (htmlEnd || htmlUntilBlank) && leadingIndent < htmlIndent)) {
          fence = null;
          htmlEnd = null;
          htmlUntilBlank = false;
          listParagraph = false;
        }
        if (fence) {
          blockedRows.push(true);
          const close = /^([ \t]*)(`+|~+)[ \t]*$/.exec(row);
          const indent = [...(close?.[1] ?? "")].reduce((column, char) => char === "\t" ? column + 4 - column % 4 : column + 1, 0);
          if (close && indent >= fence.indent && indent <= fence.indent + 3
            && close[2][0] === fence.mark && close[2].length >= fence.width) fence = null;
          continue;
        }
        if (htmlEnd) {
          blockedRows.push(true);
          if (htmlEnd.test(row)) htmlEnd = null;
          continue;
        }
        if (htmlUntilBlank) {
          blockedRows.push(true);
          if (!row.trim()) htmlUntilBlank = false;
          continue;
        }
        // List context survives indented continuation lines and blank lines.
        // Lazy paragraph prose may be outdented, but cannot introduce a literal
        // block; new block syntax or an outdent after a block ends its container.
        lazyListRows[blockedRows.length] = listParagraph && listIndents.length > 0
          && leadingIndent < (listIndents.at(-1) ?? 0);
        if (!row.trim()) listParagraph = false;
        else if (!listParagraph || startsBlock.test(row)) {
          while (listIndents.length && (listIndents.at(-1) ?? 0) > leadingIndent) listIndents.pop();
        }
        const inheritedIndent = leadingIndent >= (listIndents.at(-1) ?? 0) ? listIndents.at(-1) ?? 0 : 0;
        const relativeRow = " ".repeat(leadingIndent - inheritedIndent) + row.slice(leading.length);
        const alignmentCells = originalTableCells(relativeRow);
        const alignmentRow = alignmentCells.length > 1 && alignmentCells.every(cell => /^[ \t]*:?-+:?[ \t]*$/.test(cell));
        let container = alignmentRow ? "" : /^(?: {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$))+/.exec(relativeRow)?.[0] ?? "";
        for (const marker of container.matchAll(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]+|$)/g)) {
          const prefix = container.slice(0, marker.index + marker[0].length);
          const rawEnd = [...prefix].reduce((column, char) => char === "\t" ? column + 4 - column % 4 : column + 1, inheritedIndent);
          const markerEnd = [...prefix.replace(/[ \t]+$/, "")].reduce((column, char) => char === "\t" ? column + 4 - column % 4 : column + 1, inheritedIndent);
          const padding = rawEnd - markerEnd;
          // CommonMark: empty items and padding over four columns use one
          // content column. Excess padding remains content, not a nested list.
          const emptyItem = !relativeRow.slice(prefix.length).trim();
          listIndents.push(markerEnd + (emptyItem || padding === 0 || padding > 4 ? 1 : padding));
          if (padding > 4) { container = prefix; break; }
        }
        const containerIndent = container ? listIndents.at(-1) ?? inheritedIndent : inheritedIndent;
        const rawContainerEnd = [...container].reduce((column, char) => char === "\t" ? column + 4 - column % 4 : column + 1, inheritedIndent);
        const blockRow = " ".repeat(Math.max(0, rawContainerEnd - containerIndent)) + relativeRow.slice(container.length);
        const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(blockRow);
        if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
          fence = { mark: open[1][0], width: open[1].length, indent: containerIndent };
          listParagraph = false;
          blockedRows.push(true);
          continue;
        }
        const html = /^ {0,3}</.test(blockRow);
        if (html) {
          if (/^ {0,3}<!--/.test(blockRow)) htmlEnd = /-->/;
          else if (/^ {0,3}<\?/.test(blockRow)) htmlEnd = /\?>/;
          else if (/^ {0,3}<!\[CDATA\[/.test(blockRow)) htmlEnd = /\]\]>/;
          else if (/^ {0,3}<![A-Za-z]/.test(blockRow)) htmlEnd = />/;
          else {
            const rawTag = /^ {0,3}<(pre|script|style|textarea)(?:[ \t>]|$)/i.exec(blockRow);
            if (rawTag) htmlEnd = /<\/(?:pre|script|style|textarea)[ \t]*>/i;
            // CommonMark HTML block types 6/7. A URI autolink or inline tag
            // followed by text is not a block extending to the next blank.
            else if (/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$)/i.test(blockRow)
              || (htmlBlockRows.has(rowIndex) || listIndents.length > 0 && !listParagraph)
                && /^ {0,3}(?:<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>|<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>)[ \t]*$/.test(blockRow)) htmlUntilBlank = true;
          }
          if (htmlEnd || htmlUntilBlank) {
            htmlIndent = containerIndent;
            listParagraph = false;
            blockedRows.push(true);
            if (htmlEnd?.test(row)) htmlEnd = null;
            continue;
          }
        }
        listParagraph = listIndents.length > 0 && Boolean(blockRow.trim()) && !startsBlock.test(blockRow);
        blockedRows.push(/^(?: {4}|\t)/.test(blockRow));
      }
      // Table membership comes from the SAME GFM parser as the notebook UI,
      // with ORIGINAL offsets. Keep conservative source-literal exclusions:
      // empty-list padding differs between parser implementations, so renderer
      // membership alone must not loosen an existing literal-block refusal.
      if (blockedRows[headerRow] || blockedRows[headerRow + 1] || lazyListRows[headerRow]) return true;
      // An over-indented delimiter must not complete a lazy header. The
      // renderer admits this in some list contexts; retain the source refusal.
      const columns = (row: string) => [...(/^[ \t]*/.exec(row)?.[0] ?? "")]
        .reduce((n, ch) => ch === "\t" ? n + 4 - n % 4 : n + 1, 0);
      if (columns(originalRows[headerRow + 1] ?? "") - columns(originalRows[headerRow] ?? "") >= 4) return true;
      // Preserve conservative interruption handling inside table bodies.
      for (let index = headerRow + 2; index < currentRow; index++) {
        const row = originalRows[index];
        const bodyOffset = sourceOffsets[index];
        if (startsBlock.test(row.slice(contentStart(bodyOffset, bodyOffset + row.length) - bodyOffset))) return true;
      }
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
  const tableCells: Array<readonly [number, number]> = [];
  const tables: Array<readonly [number, number]> = [];
  const htmlBlockRows = new Set<number>();
  // Preserve supported short alignment cells without moving original quotes.
  // Only alignment rows expand; source line/column positions map back below.
  const breaks = [...text.matchAll(/\r\n|\r|\n/g)];
  const sourceOffsets = [0, ...breaks.map(match => match.index! + match[0].length)];
  const sourceRows = sourceOffsets.map((from, index) => text.slice(from, breaks[index]?.index ?? text.length));
  const projectedRows = sourceRows.map(row => {
    const cells = originalTableCells(row);
    const alignment = cells.length > 1 && cells.every(cell => /^[ \t]*:?-+:?[ \t]*$/.test(cell));
    let projected = "";
    const offsets = [0];
    for (let index = 0; index < row.length;) {
      const run = alignment && row[index] === "-" ? /^-+/.exec(row.slice(index))?.[0] : undefined;
      if (run) {
        for (let char = 0; char < Math.max(3, run.length); char++) {
          projected += "-";
          offsets.push(index + Math.min(char + 1, run.length));
        }
        index += run.length;
      } else {
        projected += row[index++];
        offsets.push(index);
      }
    }
    return { text: projected, offsets };
  });
  const parserText = projectedRows.map(row => row.text).join("\n");
  const mapPoint = (point: NonNullable<Root["position"]>["start"]) => {
    const relative = projectedRows[point.line - 1]?.offsets[point.column - 1];
    return typeof relative === "number" ? sourceOffsets[point.line - 1] + relative : undefined;
  };
  if (text.includes("|")) ReactMarkdown({
    children: parserText,
    remarkPlugins: [remarkGfm, () => (tree: Root) => {
      // HTML nodes inside paragraphs are inline; type-7 block tags cannot
      // interrupt them. Reuse parser structure instead of guessing prose state.
      type MarkdownNode = { type: string; position?: Root["position"]; children?: MarkdownNode[] };
      const stack: Array<{ node: MarkdownNode; parent: string }> = [{ node: tree, parent: "" }];
      while (stack.length) {
        const { node, parent } = stack.pop()!;
        if (node.type === "html" && parent !== "paragraph" && node.position)
          htmlBlockRows.add(node.position.start.line - 1);
        for (const child of node.children ?? []) stack.push({ node: child, parent: node.type });
      }
    }],
    allowElement(node) {
      const start = node.position?.start;
      const end = node.position?.end;
      if (start && end) {
        const from = mapPoint(start);
        const to = mapPoint(end);
        if (from === undefined || to === undefined || from > to) return true;
        if (node.tagName === "td" || node.tagName === "th") tableCells.push([from, to]);
        if (node.tagName === "table") tables.push([from, to]);
      }
      return true;
    },
  });
  const n = normalize(text);
  const keep = normalize(text, true);
  for (const m of n.matchAll(VALUE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let sign: string | undefined = m[2];
    let complete = !continues(tailAt(n, end), tailAt(keep, end)) && !laterPieceOfNumber(n, start, text, tableCells, tables, htmlBlockRows, sourceRows, sourceOffsets);
    // Decided on the ORIGINAL text: a sign, then real whitespace, with only indentation before
    // it on its line. U+2212 is always a minus. In the answer, an ASCII "- " there is Markdown
    // list syntax — rendered as a bullet, so the number is unsigned. Anywhere else (source text,
    // or another dash in the answer) it is bullet-or-minus: ambiguous, so the value is unusable.
    const at = start + (m[1]?.length ?? 0);
    if (sign && /\s/.test(text[at + 1] ?? "") && text[at] !== "−" && /^[ \t]*$/.test(text.slice(Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1, start))) {
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
  for (const match of answer.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
    const line = match[1];
    const ls = match.index ?? 0;
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

/** #4870: the number in a claimed value is part of an identifier (model, catalog, part or
 *  fault code), so the value is not a numeric claim. */
function identifierValue(answer: string, v: Value): boolean {
  const m = /\d+(?:\.\d+)?/.exec(v.text);
  if (!m) return false;
  const s = v.start + m.index;
  return identifierAt(answer, s, s + m[0].length);
}

/** #4870: does any of `texts` (model-visible chunk text; photo observations on the R4 path only)
 *  support a claimed value?
 *  The parser stays authoritative for a value it can read: a usable claim needs a usable source
 *  value that satisfies it. Only a value the parser cannot read (unitless, signed range, unknown
 *  unit) falls back to its literal text appearing verbatim. Source values are parsed once. */
class ClaimSupport {
  private parsed: Value[] | null = null;
  constructor(private readonly texts: readonly string[], private readonly answer: string) {}
  holds(claim: Value): boolean {
    if (this.texts.length === 0) return false;
    if (claim.usable) {
      this.parsed ??= this.texts.flatMap((t) => findValues(t, "source"));
      return this.parsed.some((sv) => satisfies(sv, claim));
    }
    const literal = this.literal(claim);
    if (literal === null) return false;
    // A unitless number that shares the next value's unit ("12 or 24 V") is a quantity read
    // without its unit, so a bare 12 on the page cannot support it.
    if (claim.unit === null && SHARED_UNIT.test(this.answer.slice(claim.end, claim.end + 40))) return false;
    return appearsVerbatim(literal, this.texts);
  }
  /** The value's literal text as written. A complete value is its own text. An incomplete one
   *  is never rescued by a piece: only when everything before it is clean (re-read with the text
   *  cut at its end — or with a leading "+" sign read as a sign) is it extended over what joins
   *  it on the right ("24V DC/24V AC", "12 m/s", "2 A DC"), and that WHOLE literal must be on
   *  the page. A left-joined piece (1 000, ≠0, 1e-3) returns null. */
  private literal(claim: Value): string | null {
    if (claim.complete) return claim.text;
    const plus = this.answer[claim.start - 1] === "+";
    const masked = this.answer.replace(MARKER_RE, (m) => " ".repeat(m.length));
    const probe = `${(plus ? masked.replace(/\+(?=\d)/g, " ") : masked).slice(0, claim.end)} .`;
    if (!findValues(probe, "answer").some((v) => v.start === claim.start && v.complete)) return null;
    let end = claim.end;
    for (let i = 0; i < 4; i++) {
      const rest = masked.slice(end);
      const glued = (/^[^\s,;!?()[\]{}"“”'‘’]*/u.exec(rest)?.[0] ?? "").replace(/[.:]+$/u, "");
      // A joined number keeps its own spaced unit: "12 V/24 V".
      const spaced = /\d$/.test(glued) ? /^[ \t]+([\p{L}°µΩ%℃℉][\p{L}\d·]*)/u.exec(rest.slice(glued.length)) : null;
      const unit = spaced && tableUnit(spaced[1]) ? spaced[0] : "";
      const at = glued.length + unit.length;
      const qualifier = /^[ \t]+(?:ac|dc|a\.c\.|d\.c\.|rms|peak|pk)(?![\p{L}\d])/iu.exec(rest.slice(at))?.[0] ?? "";
      if (!at && !qualifier) break;
      end += at + qualifier.length;
    }
    // The extension must explain the incompleteness: it consumed the joined text (or the only
    // problem was the "+"), and nothing after it still continues the quantity ("12 kW h",
    // "12 V (AC)", "12 A   /mm²" stay null — their bare prefix is not the value).
    if (end === claim.end && !plus) return null;
    if (continues(tailAt(normalize(masked), end), tailAt(normalize(masked, true), end))) return null;
    return `${plus ? "+" : ""}${this.answer.slice(claim.start, end)}`;
  }
}
const SHARED_UNIT = /^[ \t]*(?:or|and|to|through|-|–|,|\/)[ \t]*[-+]?\d+(?:\.\d+)?[ \t]*[\p{L}°%µΩ℃℉]/u;

/** Every numeric claim in the answer, parsed (sign, ±, comparator and markdown included) and
 *  judged once. ungroundedUnitClaim derives its boolean from these items, so there is ONE
 *  sign-aware extractor and support test (#4981 Codex r2 F1). */
export type NumericClaimAudit = {
  claims: number;
  unsupported: number;
  /** One entry per claim: its canonical unit (comparator prefix kept, null when unitless) and
   *  whether the evidence supports it. */
  items: { unit: string | null; supported: boolean }[];
};

/**
 * #4870 R4 — every numeric claim in the WHOLE answer (cited or not, any unit or none) and how
 * many of them the evidence the model was given does not support. Excluded, as in
 * assignValues: a footnote "(1)", a page reference, a list ordinal, the machine the question
 * names; and, new here, identifiers (identifierAt) and an all-zero magnitude ("verify 0 V" is
 * an isolation check, never a rating — #3963). Support is ClaimSupport over `visibleText` of each
 * source — the chunk text the provider received; production passes providerVisibleChunkText, the
 * same transform the prompt is built with (Codex r1 F1, r2 F2) — and the photo observation text.
 * Pure; counts and offsets only, no text leaves this function.
 */
export function numericClaimAudit(
  answer: string,
  question: string,
  evidence: { sources: readonly string[]; observations: readonly string[] },
  visibleText: VisibleText = modelVisiblePrefix,
): NumericClaimAudit {
  const identity = new Set(
    [...normalize(question).matchAll(/([\p{L}][\p{L}-]*)[\s-]?(\d+)/gu)].map((m) => `${m[1]}|${m[2]}`),
  );
  const masked = answer.replace(MARKER_RE, (m) => " ".repeat(m.length));
  const visible = evidence.sources.map(visibleText);
  const support = new ClaimSupport([...visible, ...evidence.observations], answer);
  const items: NumericClaimAudit["items"] = [];
  for (const v of findValues(masked, "answer")) {
    const vs = v.start;
    const ve = v.end;
    const before = normalize(masked.slice(Math.max(0, vs - 24), vs));
    const lineStart = Math.max(masked.lastIndexOf("\n", vs - 1), masked.lastIndexOf("\r", vs - 1)) + 1;
    if (v.unit === null) {
      if (masked[vs - 1] === "(" && masked[ve] === ")" && v.nums.length === 1 && Number.isInteger(v.nums[0]) && v.nums[0] < 10) continue;
      if (PAGE_RE.test(before)) continue;
      if (/^\s*(?:[-*•]\s+)?$/.test(masked.slice(lineStart, vs)) && /^[.)]\s/.test(masked.slice(ve, ve + 2))) continue;
    }
    if (v.unit === null || v.unit.startsWith("raw:")) {
      const word = before.match(/([\p{L}][\p{L}-]*)[\s-]?$/u)?.[1] ?? "";
      if (word && v.nums.length === 1 && identity.has(`${word}|${v.nums[0]}`)) continue;
      if (/^\s*-?series/i.test(masked.slice(ve, ve + 8))) continue;
    }
    if (v.nums.every((n) => n === 0)) continue;
    if (identifierValue(answer, v)) continue;
    items.push({ unit: v.unit, supported: support.holds(v) });
  }
  return { claims: items.length, unsupported: items.filter((x) => !x.supported).length, items };
}

/** The counts of numericClaimAudit (what the packet stores). */
export function numericClaimSupport(
  answer: string,
  question: string,
  evidence: { sources: readonly string[]; observations: readonly string[] },
  visibleText: VisibleText = modelVisiblePrefix,
): { claims: number; unsupported: number } {
  const { claims, unsupported } = numericClaimAudit(answer, question, evidence, visibleText);
  return { claims, unsupported };
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
  visibleText: VisibleText = modelVisiblePrefix,
): SupportingQuote {
  const claims = assignValues(answer, question).get(citationId) ?? [];
  if (claims.length === 0 || chunks.length === 0) return { quote: null, support: "question_fallback", unsupported: [] };
  const markerAt = answer.indexOf(`[${citationId}]`);
  const qterms = normalize(question).split(/[^\p{L}\p{N}.]+/u).filter((t) => t.length >= 3);
  const ids = [...claimIdentifiers(question)];
  type Cand = { chunk: number; start: number; covered: number; idHits: number; q: number; prox: number };
  const cands: Cand[] = [];
  // #4981 Codex r3 F2: every step — candidate parsing, window scoring, the returned proof quote and
  // the unsupported count — reads the SAME provider-visible text, so a user-visible proof can never
  // be cut from bytes the provider did not receive (past the cut, inside a neutralized tag).
  const visible = chunks.map(visibleText);
  visible.forEach((text, ci) => {
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
  // #4870: the count is decided in a separate pass so the proof quote above never changes. A
  // claim the quote window did not hold is still supported anywhere in the cited page's
  // MODEL-VISIBLE text (the provider never sees past MODEL_VISIBLE_CHARS — Codex r1 F1), and a
  // model/catalog/fault-code token is not a claim at all. Only the cited page counts: a photo
  // reading never authenticates a document citation (Codex r1 F2).
  const support = new ClaimSupport(visible, answer);
  // Decided ONLY by the provider-visible text: a quote-window match on the raw chunk is not
  // support when the provider never got those bytes (e.g. inside a neutralized [Source: …] tag —
  // #4981 Codex r2 F2). For ordinary text the visible text holds everything the window held.
  const unsupported = claims
    .filter((c) => !identifierValue(answer, c) && !support.holds(c))
    .map((c) => c.text.trim());
  if (cands.length === 0) return { quote: null, support: "question_fallback", unsupported };
  cands.sort(
    (a, b) =>
      b.covered - a.covered || b.idHits - a.idHits || b.q - a.q || a.prox - b.prox || a.chunk - b.chunk || a.start - b.start,
  );
  const w = cands[0];
  const text = visible[w.chunk];
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
  /** The provider-visible chunk text (#4981 Codex r2 F2); support is read only from it. */
  visibleText: VisibleText = modelVisiblePrefix,
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
    const r = supportingQuote(pageChunks, answer, c.citationId, question, visibleText);
    unsupportedValueCount += r.unsupported.length;
    if (r.quote === null) {
      quoteFallbackCount += 1;
      return c;
    }
    return { ...c, quote: r.quote };
  });
  return { citations: out, unsupportedValueCount, quoteFallbackCount };
}
