/**
 * Bounded, question-aware selection of what the model sees of one retrieved chunk (#6030).
 *
 * Pure (no imports) so the prompt builder (lib/manual-rag.ts) and every validator that must judge
 * the text the model actually saw (capabilities/supporting-quote.ts, claim-verifier-shadow.ts) share
 * ONE function without an import cycle. `modelVisibleContent` is that single entry point.
 */
export const MAX_CONTENT_CHARS = 1200;
// Higher limit for table-heavy chunks to preserve complete rows
export const MAX_CONTENT_CHARS_TABLE = 2400;
// Detect pipe-delimited table rows (markdown tables and manual tables)
export const PIPE_TABLE_ROW_RE = /^\s*\|.+\|.+\|/m;
// Detect if text is table-heavy (>30% of lines are table rows)
export function isTableHeavy(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length < 5) return false;
  const tableLines = lines.filter(line => PIPE_TABLE_ROW_RE.test(line));
  return tableLines.length / lines.length > 0.3;
}

/**
 * Identifiers and symptom terms from the question that may appear in table
 * rows (#6030 F4/F5).
 *
 * `exact` holds COMPLETE identifiers (fault codes `F081`, dotted parameters
 * `P06.53`, terminal numbers); they are only ever matched as whole tokens, so
 * `P06` never matches `P06.53`, `P06.530` or `XP06.53`, and a dotted parameter
 * does not also contribute its `P06` prefix. `symptoms` holds SPECIFIC symptom
 * words only. Broad words ("fault", "error", "alarm", "warning", "trip") appear
 * in nearly every fault-table row and would crowd out the real answer, so they
 * are deliberately not extracted.
 */
export interface QuestionTerms {
  exact: Set<string>;
  symptoms: Set<string>;
}

export function extractQuestionTerms(question: string): QuestionTerms {
  const exact = new Set<string>();
  const symptoms = new Set<string>();

  // Dotted parameters first, then mask them so their prefix is not re-captured.
  let rest = question.replace(
    /(?<![A-Za-z0-9])[A-Za-z]{1,2}\d{1,3}\.\d{1,4}(?![A-Za-z0-9])/g,
    (m) => {
      exact.add(m.toUpperCase());
      return " ";
    },
  );
  // Undotted fault codes / parameters: F081, E001, P042, F16.
  rest = rest.replace(
    /(?<![A-Za-z0-9.])[A-Za-z]{1,2}\d{2,4}(?![A-Za-z0-9])(?!\.\d)/g,
    (m) => {
      exact.add(m.toUpperCase());
      return " ";
    },
  );
  // Terminal numbers: "terminal 07", "T12".
  for (const m of rest.matchAll(/\bterminals?\s*#?(\d{1,3})\b/gi)) {
    exact.add(m[1].padStart(2, "0"));
  }
  for (const m of rest.matchAll(/\bT(\d{1,3})\b/g)) {
    exact.add(m[1].padStart(2, "0"));
  }

  const symptomPatterns = [
    /\b(overcurrent|overvoltage|undervoltage|overload|overtemp|overheat)\b/gi,
    /\b(ground\s*fault|phase\s*loss|short\s*circuit)\b/gi,
    /\b(yellow|red|green|amber|orange|blue|flashing|solid|blinking)\b/gi,
  ];
  for (const pattern of symptomPatterns) {
    for (const m of question.matchAll(pattern)) {
      symptoms.add(m[0].toLowerCase().replace(/\s+/g, " "));
    }
  }
  return { exact, symptoms };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-token matcher on an UPPERCASED line: no alnum/`_`/`.` before, no alnum/`_`/`.digit` after. */
function exactTermRe(term: string): RegExp {
  return new RegExp(`(?<![A-Z0-9_.])${escapeRe(term)}(?![A-Z0-9_]|\\.\\d)`);
}

function symptomTermRe(term: string): RegExp {
  return new RegExp(`\\b${escapeRe(term).replace(/ /g, "\\s*")}s?\\b`, "i");
}

/** Hard cap on one compacted table-heavy chunk, markers and headings included. */
export const TABLE_COMPACT_BUDGET = MAX_CONTENT_CHARS_TABLE;
/** Reserved for the trailing "requested rows not shown" marker so the total stays <= TABLE_COMPACT_BUDGET. */
const HELD_MARKER_RESERVE = 120;
const NOTE_MARKER_RE = /^\s*(\*|†|‡|note\b|\(\d+\)|\d+\))/i;
const SEPARATOR_ROW_RE = /^\s*\|[\s\-:]+(\|[\s\-:]+)+\|?\s*$/;

interface TableBlock {
  /** Index of the first data row and one past the last. */
  rowStart: number;
  rowEnd: number;
  /** This table's OWN column header lines (header + separator), if it has one. */
  header: string[];
  /** Whole section block above (heading + qualifiers), uncapped. */
  preamble: string[];
  /** Whole footnote / explanatory block directly below, uncapped. */
  notes: string[];
  /** Line range this table owns, including preamble and notes. */
  spanStart: number;
  spanEnd: number;
}

/** Split text into tables; each carries only its own heading, header and notes. */
function parseTables(lines: string[]): TableBlock[] {
  const tables: TableBlock[] = [];
  let boundary = 0; // end of the previous table's span
  let i = 0;
  while (i < lines.length) {
    if (!PIPE_TABLE_ROW_RE.test(lines[i])) {
      i++;
      continue;
    }
    const tableStart = i;
    let header: string[] = [];
    let rowStart = i;
    if (i + 1 < lines.length && SEPARATOR_ROW_RE.test(lines[i + 1]) && !SEPARATOR_ROW_RE.test(lines[i])) {
      header = [lines[i], lines[i + 1]];
      rowStart = i + 2;
    }
    let j = rowStart;
    while (j < lines.length && PIPE_TABLE_ROW_RE.test(lines[j])) j++;
    const rowEnd = j;

    // Applicability block = the table's whole current section: from the nearest
    // markdown heading above it (and below the previous table) down to the
    // table; with no heading, the contiguous non-blank block directly above.
    // No line-count cap: if it is needed to qualify the table it is kept, and
    // if it cannot fit with a row the table is held (never shown unqualified).
    let spanStart = tableStart;
    let headingAt = -1;
    for (let k = tableStart - 1; k >= boundary; k--) {
      if (/^\s{0,3}#{1,6}\s/.test(lines[k])) {
        headingAt = k;
        break;
      }
    }
    if (headingAt >= 0) {
      spanStart = headingAt;
    } else {
      // No markdown heading: the paragraph directly above is the caption/qualifier, and so is every
      // blank-separated ONE-LINE paragraph above it (captions like "Model B only", "Firmware 2
      // required"). A multi-line paragraph is prose, not a qualifier, and ends the block; so does the
      // previous table's span. Structural, not a line count.
      while (spanStart - 1 >= boundary && lines[spanStart - 1].trim() !== "") spanStart--;
      for (;;) {
        let k = spanStart - 1;
        while (k >= boundary && lines[k].trim() === "") k--;
        if (k < boundary || (k - 1 >= boundary && lines[k - 1].trim() !== "")) break; // none, or multi-line prose
        spanStart = k;
      }
    }
    const preamble = lines.slice(spanStart, tableStart).filter((l) => l.trim() !== "");

    // Notes = the whole footnote block: every non-table line directly below the table up to the next
    // blank line, heading or table; and, across blank lines, every further block that starts like a
    // footnote (a note separated by a blank line still qualifies the rows above it).
    const notes: string[] = [];
    let n = rowEnd;
    let end = rowEnd;
    for (;;) {
      let m = n;
      while (m < lines.length && lines[m].trim() === "") m++;
      const startsNote = m > n ? m < lines.length && NOTE_MARKER_RE.test(lines[m]) : m < lines.length;
      if (!startsNote || m >= lines.length || PIPE_TABLE_ROW_RE.test(lines[m]) || /^#{1,6}\s/.test(lines[m])) break;
      while (m < lines.length && lines[m].trim() !== "" && !PIPE_TABLE_ROW_RE.test(lines[m]) && !/^#{1,6}\s/.test(lines[m])) {
        notes.push(lines[m]);
        m++;
      }
      n = m;
      end = m;
    }
    const spanEnd = notes.length > 0 ? end : rowEnd;
    tables.push({ rowStart, rowEnd, header, preamble, notes, spanStart, spanEnd });
    boundary = spanEnd;
    i = spanEnd;
  }
  return tables;
}

const OMITTED = "[… omitted …]";

/**
 * Heading/qualifier, column header, kept rows and footnotes are always emitted
 * COMPLETE and verbatim; nothing is clipped. When a table does not fit, whole
 * rows are left out (marked), never part of a row or of its qualifiers.
 */
function renderTable(t: TableBlock, lines: string[], rows: number[]): string {
  const out: string[] = [...t.preamble, ...t.header];
  let prev = t.rowStart - 1;
  for (const r of rows) {
    const gap = r - prev - 1;
    if (gap > 0) out.push(`[… ${gap} row${gap === 1 ? "" : "s"} omitted …]`);
    out.push(lines[r]);
    prev = r;
  }
  const tail = t.rowEnd - 1 - prev;
  if (tail > 0) out.push(`[… ${tail} row${tail === 1 ? "" : "s"} omitted …]`);
  out.push(...t.notes);
  return out.join("\n");
}

const hasText = (lines: string[], a: number, b: number): boolean =>
  lines.slice(Math.max(a, 0), Math.max(b, 0)).some((l) => l.trim() !== "");

/**
 * Select rows of an over-long table-heavy chunk that match the question, within
 * TABLE_COMPACT_BUDGET characters in total. Selection is per table: a kept row
 * is always rendered under its OWN heading/qualifier and column header, gaps are
 * marked explicitly, and rows from different tables are never made adjacent.
 * Complete requested rows (exact identifiers) are reserved first, each emitted whole under its full heading/header/notes (no clipping, no compact mode), then specific
 * symptom rows (most symptom words first), then one neighbouring row of each
 * exact hit as context while budget remains. Returns null when nothing matched
 * (a held-rows note is returned when matches exist but none fit), so the caller falls back to the row-boundary prefix.
 */
function selectTableRows(text: string, terms: QuestionTerms, budget: number): string | null {
  const lines = text.split("\n");
  const tables = parseTables(lines);
  if (tables.length === 0) return null;
  const exactRes = Array.from(terms.exact).map(exactTermRe);
  const symRes = Array.from(terms.symptoms).map(symptomTermRe);

  type Cand = { t: number; r: number; pri: number; score: number };
  const exactHits: Cand[] = [];
  const symHits: Cand[] = [];
  tables.forEach((tb, t) => {
    for (let r = tb.rowStart; r < tb.rowEnd; r++) {
      const upper = lines[r].toUpperCase();
      if (exactRes.some((re) => re.test(upper))) {
        exactHits.push({ t, r, pri: 0, score: 0 });
        continue;
      }
      const score = symRes.filter((re) => re.test(lines[r])).length;
      if (score > 0) symHits.push({ t, r, pri: 1, score });
    }
  });
  if (exactHits.length === 0 && symHits.length === 0) return null;

  symHits.sort((a, b) => b.score - a.score || a.t - b.t || a.r - b.r);
  const neighbours: Cand[] = [];
  for (const h of exactHits) {
    const tb = tables[h.t];
    if (h.r + 1 < tb.rowEnd) neighbours.push({ t: h.t, r: h.r + 1, pri: 2, score: 0 });
    if (h.r - 1 >= tb.rowStart) neighbours.push({ t: h.t, r: h.r - 1, pri: 2, score: 0 });
  }
  const queue = [...exactHits, ...symHits.slice(0, 200), ...neighbours];

  const selected = tables.map(() => new Set<number>());
  const assemble = (): string => {
    const parts: string[] = [];
    let lastEnd = 0;
    tables.forEach((tb, t) => {
      if (selected[t].size === 0) return;
      if (hasText(lines, lastEnd, tb.spanStart)) parts.push(OMITTED);
      parts.push(renderTable(tb, lines, Array.from(selected[t]).sort((a, b) => a - b)));
      lastEnd = tb.spanEnd;
    });
    if (hasText(lines, lastEnd, lines.length)) parts.push(OMITTED);
    return parts.join("\n\n");
  };

  // A table's heading/header/footnotes are charged the first time one of its
  // rows is added, and are never traded away for further rows.
  let heldExact = 0;
  let placed = 0;
  for (const c of queue) {
    if (selected[c.t].has(c.r)) continue;
    selected[c.t].add(c.r);
    if (assemble().length <= budget - HELD_MARKER_RESERVE) {
      placed++;
      continue;
    }
    selected[c.t].delete(c.r);
    if (c.pri === 0) heldExact++;
  }
  const heldNote =
    "[… matching rows not shown: they do not fit the context budget alongside their heading, header and notes …]";
  if (placed === 0) return heldExact > 0 ? heldNote : null;
  return heldExact > 0 ? `${assemble()}\n\n${heldNote}` : assemble();
}

/**
 * Smart truncation for over-long chunks. Table-heavy chunks with question
 * terms keep the matching rows (see selectTableRows); everything else keeps the
 * previous row-boundary / prefix behaviour. Output never exceeds the limit
 * (plus the trailing ellipsis).
 */
export function smartTruncate(text: string, terms?: QuestionTerms): string {
  const tableHeavy = isTableHeavy(text);
  const limit = tableHeavy ? MAX_CONTENT_CHARS_TABLE : MAX_CONTENT_CHARS;

  if (text.length <= limit) return text;

  // A passage that mixes prose with a table (not table-heavy) takes the same row selection when a
  // table row matches the question, within the plain limit; otherwise it keeps its prefix.
  if (terms && (terms.exact.size > 0 || terms.symptoms.size > 0)) {
    const picked = selectTableRows(text, terms, limit);
    if (picked) return picked;
  }
  if (!tableHeavy) return `${text.slice(0, limit)}…`;

  // Fallback: truncate at row boundary
  const lines = text.split("\n");
  let accum = 0;
  let lastCompleteRow = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1;
    if (accum + lineLen > limit) {
      if (lastCompleteRow > 0 && i > lastCompleteRow) {
        return lines.slice(0, lastCompleteRow + 1).join("\n") + "\n…";
      }
      break;
    }
    accum += lineLen;
    if (PIPE_TABLE_ROW_RE.test(lines[i]) || lines[i].trim() === "") {
      lastCompleteRow = i;
    }
  }
  return `${text.slice(0, limit)}…`;
}

const FORGED_HEADER_RE = /---\s*\[\s*\d+\s*\][^\n]*?---/gi;
const SOURCE_TAG_RE = /\[Source:[^\]]+\]/gi;

/** Strips forged reference headers / source tags from retrieved text before it reaches a prompt. */
export function neutralizeReferenceText(text: string): string {
  return text
    .replace(FORGED_HEADER_RE, "[REF_DELIMITER]")
    .replace(SOURCE_TAG_RE, "[ref]");
}

/**
 * What the model is shown of `content` for `question`: the same bounded selection the prompt uses,
 * after the same forged-delimiter neutralisation. A value that only appears inside a neutralised
 * delimiter is NOT visible to the model and is not evidence.
 */
export function modelVisibleContent(content: string, question: string | undefined): string {
  return neutralizeReferenceText(smartTruncate(content, question ? extractQuestionTerms(question) : undefined));
}
