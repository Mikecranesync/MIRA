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
const SEPARATOR_ROW_RE = /^\s*\|[\s\-:]+(\|[\s\-:]+)+\|?\s*$/;

interface TableBlock {
  /** Index of the first data row and one past the last. */
  rowStart: number;
  rowEnd: number;
  /** This table's OWN column header lines (header + separator), if it has one. */
  header: string[];
  /**
   * Line indices of everything that scopes the table from above, in order: each ENCLOSING ancestor
   * heading with its lead text (a "## Model B only" parent of "### Fault codes"), then the table's own
   * section from its nearest heading (or, with no heading, the whole block since the previous table).
   */
  context: number[];
  /** Line indices of everything below the table up to the next heading or table (notes, applicability). */
  notes: number[];
  /** The notes run up to another table, so their last lines may be that table's caption. */
  notesReachNextTable: boolean;
  /** Line range of the table's own section (own heading/caption block through its notes). */
  spanStart: number;
  spanEnd: number;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s/;
const nonBlank = (lines: string[], a: number, b: number): number[] => {
  const out: number[] = [];
  for (let k = a; k < b; k++) if (lines[k].trim() !== "") out.push(k);
  return out;
};

/**
 * Split text into tables. Each carries the COMPLETE scope it needs to be read correctly (native-review-2
 * F6): enclosing headings, the whole own section above it and the whole text below it. Nothing here is
 * a guess about which line "looks like" a qualifier; if the scope cannot fit with a row, the row is held.
 */
function parseTables(lines: string[]): TableBlock[] {
  const tables: TableBlock[] = [];
  let boundary = 0; // end of the previous table's ROWS (text between two tables scopes both)
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

    // Markdown heading stack in force at the table.
    const stack: { idx: number; level: number }[] = [];
    for (let k = 0; k < tableStart; k++) {
      const m = HEADING_RE.exec(lines[k]);
      if (!m) continue;
      while (stack.length > 0 && stack[stack.length - 1].level >= m[1].length) stack.pop();
      stack.push({ idx: k, level: m[1].length });
    }
    const own = stack.length > 0 && stack[stack.length - 1].idx >= boundary ? stack.pop() : undefined;
    const context: number[] = [];
    for (const anc of stack) {
      // Ancestor heading + its lead text, up to the next heading or the first table row.
      let e = anc.idx + 1;
      while (e < tableStart && !HEADING_RE.test(lines[e]) && !PIPE_TABLE_ROW_RE.test(lines[e])) e++;
      context.push(...nonBlank(lines, anc.idx, e));
    }
    // Own section: from the nearest heading below the previous table, else the whole block since it.
    const spanStart = own ? own.idx : boundary;
    for (const k of nonBlank(lines, spanStart, tableStart)) if (!context.includes(k)) context.push(k);

    // Notes: everything below the rows up to the next heading or table, blank-separated or not.
    let e = rowEnd;
    while (e < lines.length && !HEADING_RE.test(lines[e]) && !PIPE_TABLE_ROW_RE.test(lines[e])) e++;
    const notes = nonBlank(lines, rowEnd, e);
    const notesReachNextTable = e < lines.length && PIPE_TABLE_ROW_RE.test(lines[e]);
    const spanEnd = notes.length > 0 ? notes[notes.length - 1] + 1 : rowEnd;
    tables.push({ rowStart, rowEnd, header, context, notes, notesReachNextTable, spanStart, spanEnd });
    boundary = rowEnd;
    i = rowEnd;
  }
  return tables;
}

const OMITTED = "[… omitted …]";
const NEXT_TABLE = "[… the text above is followed directly by another table …]";

/**
 * Scope lines, column header, kept rows and notes are always emitted COMPLETE and verbatim; nothing is
 * clipped. When a table does not fit, whole rows are left out (marked), never part of a row or of its
 * scope. A scope line already emitted for an earlier selected table (shared parent heading, text
 * between two tables) is not repeated.
 */
function renderTable(t: TableBlock, lines: string[], rows: number[], emitted: Set<number>): string {
  const take = (idx: number[]): string[] =>
    idx.filter((k) => !emitted.has(k)).map((k) => {
      emitted.add(k);
      return lines[k];
    });
  const out: string[] = [...take(t.context), ...t.header];
  let prev = t.rowStart - 1;
  for (const r of rows) {
    const gap = r - prev - 1;
    if (gap > 0) out.push(`[… ${gap} row${gap === 1 ? "" : "s"} omitted …]`);
    out.push(lines[r]);
    prev = r;
  }
  const tail = t.rowEnd - 1 - prev;
  if (tail > 0) out.push(`[… ${tail} row${tail === 1 ? "" : "s"} omitted …]`);
  const notes = take(t.notes);
  out.push(...notes);
  // Text between two tables can be this table's note OR the next table's caption; say which way it runs.
  if (notes.length > 0 && t.notesReachNextTable) out.push(NEXT_TABLE);
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
  // Which exact terms each row names, and in how many rows each term occurs (its frequency).
  const rowTerms = new Map<string, number[]>();
  const df = exactRes.map(() => 0);
  tables.forEach((tb, t) => {
    for (let r = tb.rowStart; r < tb.rowEnd; r++) {
      const upper = lines[r].toUpperCase();
      const hit = exactRes.map((re, k) => (re.test(upper) ? k : -1)).filter((k) => k >= 0);
      for (const k of hit) df[k]++;
      if (hit.length > 0) {
        rowTerms.set(`${t}:${r}`, hit);
        exactHits.push({ t, r, pri: 0, score: 0 });
        continue;
      }
      const score = symRes.filter((re) => re.test(lines[r])).length;
      if (score > 0) symHits.push({ t, r, pri: 1, score });
    }
  });
  if (exactHits.length === 0 && symHits.length === 0) return null;

  // An identifier that occurs in many rows is SCOPE (the model word every row of a GS10 table
  // repeats), not the lookup: the rows that answer "P06.53 on the GS10" are the ones naming the rare
  // identifier, whether or not they also repeat the model ("All variants | P06.53"). So rows are ranked
  // by rarity-weighted coverage (each matched identifier counts 1/frequency), and only rows naming a
  // non-scope identifier are "requested". A term is scope when it is both common (>= 5 rows) and far
  // more common than the rarest matched identifier. Scope-only rows stay as context while budget remains.
  const matchedDf = df.filter((d) => d > 0);
  const minDf = matchedDf.length > 0 ? Math.min(...matchedDf) : 0;
  const isScope = df.map((d) => d >= 5 && d > 4 * minDf);
  for (const h of exactHits) {
    const hit = rowTerms.get(`${h.t}:${h.r}`) ?? [];
    h.score = hit.reduce((s, k) => s + 1 / df[k], 0);
    if (hit.every((k) => isScope[k])) h.pri = 1;
  }
  exactHits.sort((a, b) => b.score - a.score || a.t - b.t || a.r - b.r);
  symHits.sort((a, b) => b.score - a.score || a.t - b.t || a.r - b.r);
  const requested = exactHits.filter((x) => x.pri === 0);
  const scopeOnly = exactHits.filter((x) => x.pri !== 0);
  const neighbours: Cand[] = [];
  for (const h of requested) {
    const tb = tables[h.t];
    if (h.r + 1 < tb.rowEnd) neighbours.push({ t: h.t, r: h.r + 1, pri: 2, score: 0 });
    if (h.r - 1 >= tb.rowStart) neighbours.push({ t: h.t, r: h.r - 1, pri: 2, score: 0 });
  }
  // Requested rows first, then symptom rows, then the requested rows' neighbours, then scope-only rows.
  const queue = [...requested.slice(0, 200), ...symHits.slice(0, 200), ...neighbours, ...scopeOnly.slice(0, 200)];

  const selected = tables.map(() => new Set<number>());
  const assemble = (): string => {
    const parts: string[] = [];
    const emitted = new Set<number>();
    let lastEnd = 0;
    tables.forEach((tb, t) => {
      if (selected[t].size === 0) return;
      const firstScope = tb.context.find((k) => !emitted.has(k)) ?? tb.spanStart;
      if (hasText(lines, lastEnd, Math.min(firstScope, tb.spanStart))) parts.push(OMITTED);
      parts.push(renderTable(tb, lines, Array.from(selected[t]).sort((a, b) => a - b), emitted));
      lastEnd = Math.max(lastEnd, tb.spanEnd);
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

type DedupeChunk = { content: string; sourceUrl: string; sourcePage: number | null; docId?: string | null };

const lineBreaks = (text: string): number => (text.trim().match(/\n/g) ?? []).length;

/**
 * The retrieved passages the model is actually shown, in order (#6030 F1, native review 2).
 *
 * Keeps every DISTINCT passage; two passages of one page both reach the model under that page's
 * single citation number. Passages that are the same text once whitespace is collapsed — same
 * document, same page (null stays distinct from a number), case kept (4 mV vs 4 MV) — are one
 * passage and appear once, at the first one's position. Of those copies the one with the most line
 * breaks is kept: a copy flattened onto one line has lost the row structure that row selection
 * needs, so keeping it whenever it happened to arrive first dropped the requested table row.
 *
 * The prompt builder (lib/manual-rag.ts) and the validators (supporting-quote.ts pagesByCitation)
 * both read through this, so a validator never judges a copy the model did not see.
 */
export function modelVisibleChunks<T extends DedupeChunk>(chunks: readonly T[]): T[] {
  const slot = new Map<string, number>();
  const kept: T[] = [];
  for (const c of chunks) {
    const key = [
      c.docId ?? "",
      c.sourceUrl,
      c.sourcePage == null ? "?" : String(c.sourcePage),
      c.content.replace(/\s+/g, " ").trim(),
    ].join("\u0000");
    const at = slot.get(key);
    if (at === undefined) {
      slot.set(key, kept.length);
      kept.push(c);
    } else if (lineBreaks(c.content) > lineBreaks(kept[at].content)) {
      kept[at] = c;
    }
  }
  return kept;
}
