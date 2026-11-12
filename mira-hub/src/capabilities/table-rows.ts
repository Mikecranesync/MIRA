/**
 * Table rows at upload (garage pilot, plan row 1-A; ledger L3/L4/L5).
 *
 * See `table-rows.test.ts`'s header comment for the full rules — that comment IS the spec this
 * file implements literally. Pure, deterministic, zero tokens: no model call, no vendor-shape
 * regex (the only shape test is "an identifier cell": letters AND digits, >=5 chars, no spaces).
 */
import { tableUnit } from "./supporting-quote";
import { modelNumbersIn } from "./manual-applicability";

export type LayoutItem = { str: string; x: number; y: number; w: number; size: number };
export type TableCell = { model: string; value: string };
export type TableRow = { label: string; unit: string | null; cells: TableCell[]; merged: boolean };
export type TableBlock = {
  caption: string;
  header: string;
  models: string[];
  modelKeys: string[];
  rows: TableRow[];
  unqualified: string[];
  top: number;
  bottom: number;
};
export type TableChunk = { text: string; models: string[]; unqualified: boolean };
/** A MODEL-KEYED table (one model per line in a left column, attributes as columns — the GS10
 *  Appendix A cable-length table, #5450): its header band + model lines as rendered text, and the
 *  models of its key column. It carries NO rows on purpose: cells merged down a group of models
 *  cannot be bounded from text positions, so no value is attributed to any model (fail closed). */
export type ModelKeyedTable = { caption: string; lines: string[]; models: string[]; modelKeys: string[]; top: number; bottom: number };

/** A line: items already sorted left-to-right (x ascending), with a representative y. */
interface Line {
  y: number;
  items: LayoutItem[];
}

const LINE_GAP_PT = 2.5;
const CAPTION_BAND_PT = 40;
const ATTACH_BAND_PT = 14;
const BLOCK_GAP_MULT = 3;
/** Gap, in the x direction, below which two consecutive value items are the SAME fragmented
 *  cell rather than two adjacent columns (see `groupRuns`). Deliberately NOT `cols.tol`
 *  (≈12–15pt on the pilot fixtures): on the Micro820 Isolation-voltage block, real adjacent
 *  columns sit as close as 8.05pt apart (long label text narrows the gap below the column
 *  pitch), while every real same-cell pdf.js fragment gap measured on the pilot fixtures is
 *  ≤0.72pt. `LINE_GAP_PT`'s 2.5pt sits safely between both and is already the module's
 *  constant for "tiny gap = contiguous content", applied here on the x axis instead of y. */
const RUN_GAP_PT = LINE_GAP_PT;
/** Model-keyed table (#5450): the key column's identifier cells must share one x within this
 *  tolerance (p.394 prints every model at x=111.x), and a run needs this many model lines. */
const MODEL_KEY_X_TOL_PT = 6;
const MODEL_KEYED_MIN_LINES = 3;
/** The header band above a model-keyed run: lines whose gap to the line below is at most this
 *  multiple of the run's own median line pitch (p.394: pitch ≈ 11 pt; the band's gaps are ≤ 13 pt
 *  and the section title above it sits 33 pt away). */
const MODEL_KEYED_HEADER_GAP_MULT = 2;

/** uppercase, drop a trailing "(…)" group, keep [A-Z0-9] only. */
export function exactModelKey(cell: string): string {
  const upper = cell.toUpperCase();
  const noSuffix = upper.replace(/\([^()]*\)\s*$/, "");
  return noSuffix.replace(/[^A-Z0-9]/g, "");
}

/** letters AND digits, length >= 5, no internal spaces (the only shape test used anywhere here). */
function isIdentifierCell(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 5 || /\s/.test(t)) return false;
  return /[A-Za-z]/.test(t) && /\d/.test(t);
}

/** Collapse a run of item strings (already x-ordered) into one rendered line of text. */
function renderItems(items: readonly LayoutItem[]): string {
  return items
    .map((i) => i.str.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Group non-blank items into lines (gap <= 2.5pt from the previous item's y), x-sorted within
 *  each line, lines sorted top (largest y) to bottom (smallest y) — reading order. */
function buildLines(items: readonly LayoutItem[]): Line[] {
  const nonBlank = items.filter((i) => i.str.trim() !== "");
  const sorted = [...nonBlank].sort((a, b) => b.y - a.y);
  const lines: Line[] = [];
  let current: LayoutItem[] | null = null;
  let lastY = 0;
  for (const it of sorted) {
    if (current && Math.abs(lastY - it.y) <= LINE_GAP_PT) {
      current.push(it);
    } else {
      current = [it];
      lines.push({ y: it.y, items: current });
    }
    lastY = it.y;
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** A line's identifier-shaped cells (candidate header models), x-ordered. */
function identifierCells(line: Line): LayoutItem[] {
  return line.items.filter((i) => isIdentifierCell(i.str));
}

/** A header line: >= 2 distinct identifier cells. */
function isHeaderLine(line: Line): boolean {
  return identifierCells(line).length >= 2;
}

/** The median of a (non-empty) number array. */
function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** A value is "number-shaped": /^[\[(]?[\d.\/–-]+[\])]?%?$/. */
function isNumberShaped(v: string): boolean {
  return /^[[(]?[\d.\/–-]+[)\]]?%?$/.test(v.trim());
}

/** Column geometry for one table block: x position per model column + the label-area boundary. */
interface Columns {
  x: number[];
  tol: number;
  boundary: number;
}

/** Seed column x's from the header's own identifier-cell x's, then refine with the median x of
 *  the rightmost `n` items of every line in `window` that has >= n items and whose candidate
 *  sample at position i lands within half a column-pitch of the seed (rejects unrelated
 *  sub-tables, e.g. the Micro820 wire-size grid, from pulling the columns off true position). */
function computeColumns(headerX: number[], window: readonly Line[]): Columns {
  const n = headerX.length;
  const seedPitch = n >= 2 ? median(headerX.slice(1).map((x, i) => x - headerX[i])) : 60;
  const halfPitch = Math.max(20, Math.abs(seedPitch) / 2);
  const samples: number[][] = headerX.map((x) => [x]);
  for (const line of window) {
    if (line.items.length < n) continue;
    const suffix = line.items.slice(line.items.length - n);
    for (let i = 0; i < n; i++) {
      if (Math.abs(suffix[i].x - headerX[i]) <= halfPitch) samples[i].push(suffix[i].x);
    }
  }
  const x = samples.map((s) => median(s));
  const pitch = n >= 2 ? median(x.slice(1).map((v, i) => v - x[i])) : seedPitch;
  const tol = Math.max(6, 0.15 * Math.abs(pitch));
  return { x, tol, boundary: x[0] - tol };
}

/** Index of the nearest column to `x`. */
function nearestColumn(x: number, cols: Columns): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < cols.x.length; i++) {
    const d = Math.abs(x - cols.x[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** A horizontal run: consecutive items (x-ascending) whose gap from the previous item's right
 *  edge is <= tol join the same run; a whitespace-only item joins whatever run it touches and
 *  contributes nothing but a space once rendered. `leftX` is the run's own LEFT edge (its first
 *  item's x), never a per-item x, so a cell split into several fragments by pdf.js is assigned to
 *  one column by where it STARTS — never pulled toward a column a later fragment's x happens to
 *  land nearer to (Codex #5429 r1 F1). */
interface Run {
  items: LayoutItem[];
  leftX: number;
}

function groupRuns(items: readonly LayoutItem[], tol: number): Run[] {
  const runs: Run[] = [];
  let current: LayoutItem[] | null = null;
  let prevEnd = -Infinity;
  for (const it of items) {
    if (current && it.x - prevEnd <= tol) {
      current.push(it);
    } else {
      current = [it];
      runs.push({ items: current, leftX: it.x });
    }
    prevEnd = Math.max(prevEnd, it.x + it.w);
  }
  return runs;
}

/** Strip a leading 1-2 digit footnote-mark token ("2 CT ..." -> "CT ..."). */
function stripFootnoteMark(text: string): string {
  return text.replace(/^\d{1,2}\b\s*/, "");
}

/** Trailing-unit extraction: a parenthesised <=4-letter group ("(kg)", "(VAC)", "(Hz)") strips to
 *  its bare letters; else the last whitespace-separated token is tested against the closed table
 *  (supporting-quote's `tableUnit`), kept AS PRINTED when recognised. */
function extractUnit(text: string): { label: string; unit: string | null } {
  const paren = /^(.*?)[ \t]*\(([A-Za-z]{1,4})\)$/.exec(text);
  if (paren) return { label: paren[1].trim(), unit: paren[2] };
  const idx = text.lastIndexOf(" ");
  if (idx === -1) {
    return tableUnit(text) !== null ? { label: "", unit: text } : { label: text, unit: null };
  }
  const last = text.slice(idx + 1);
  if (tableUnit(last) !== null) return { label: text.slice(0, idx).trim(), unit: last };
  return { label: text, unit: null };
}

/** Build the `label`/`unit` from a line's label-area items: footnote-strip, then unit-extract. */
function labelAndUnit(labelItems: readonly LayoutItem[]): { label: string; unit: string | null } {
  const raw = stripFootnoteMark(renderItems(labelItems));
  return extractUnit(raw);
}

/** Splits a line's items into label-area and value-area by `cols.boundary`, but treats the FIRST
 *  item that crosses the boundary as part of the label run (not a real cell) when it is nearly
 *  touching the item before it (gap <= cols.tol) — a flowing sentence that pdf.js split into
 *  several items can land a fragment past the boundary by coincidence (a footnote's quoted phrase
 *  is the real case), while a genuine column value is always separated from the label by a wide
 *  gap (the column pitch). Once a real value cell is accepted, later items keep their own test
 *  independently, so this never merges two genuine column values together. */
function splitLabelValue(line: Line, cols: Columns): { labelItems: LayoutItem[]; valueItems: LayoutItem[] } {
  const labelItems: LayoutItem[] = [];
  const valueItems: LayoutItem[] = [];
  let prevEnd = -Infinity;
  for (const it of line.items) {
    const crossesBoundary = it.x >= cols.boundary;
    const isStrayFragment = crossesBoundary && valueItems.length === 0 && labelItems.length > 0 && it.x - prevEnd <= cols.tol;
    if (!crossesBoundary || isStrayFragment) {
      labelItems.push(it);
    } else {
      valueItems.push(it);
    }
    prevEnd = Math.max(prevEnd, it.x + it.w);
  }
  return { labelItems, valueItems };
}

/** Up to two lines directly above the header (<=40pt), with no column cells, pure-number lines
 *  dropped — in top-to-bottom reading order. */
function captionFor(lines: readonly Line[], headerIdx: number, cols: Columns): string {
  const picked: Line[] = [];
  for (let i = headerIdx - 1; i >= 0 && picked.length < 2; i--) {
    const l = lines[i];
    if (l.y - lines[headerIdx].y > CAPTION_BAND_PT) break;
    const hasColumnCell = l.items.some((it) => it.x >= cols.boundary);
    if (hasColumnCell) continue;
    const text = renderItems(l.items);
    if (/^\d+$/.test(text)) continue;
    picked.unshift(l);
  }
  return picked.map((l) => renderItems(l.items)).join(" / ");
}

/** Build one TableBlock starting at `lines[headerIdx]`. Returns the block and the index of the
 *  first line NOT consumed by it (where the outer scan should resume). */
function buildBlock(lines: readonly Line[], headerIdx: number): { block: TableBlock; nextIdx: number } {
  const header = lines[headerIdx];
  const idCells = identifierCells(header);
  const models = idCells.map((c) => c.str.trim());
  const modelKeys = models.map(exactModelKey);
  const n = models.length;
  const headerLabelItems = header.items.filter((it) => !idCells.includes(it));
  const headerLabel = renderItems(headerLabelItems);

  // Loose window for bootstrap + median-pitch: header+1 .. next header or EOF.
  let windowEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (isHeaderLine(lines[i])) {
      windowEnd = i;
      break;
    }
  }
  const window = lines.slice(headerIdx + 1, windowEnd);
  const cols = computeColumns(idCells.map((c) => c.x), window);

  const gaps: number[] = [];
  for (let i = headerIdx; i + 1 < windowEnd; i++) gaps.push(lines[i].y - lines[i + 1].y);
  const medianGap = gaps.length > 0 ? median(gaps) : 12;
  const hardStopGap = BLOCK_GAP_MULT * Math.max(medianGap, 1);

  const rows: TableRow[] = [];
  const unqualified: string[] = [];
  const rowLines = new Map<TableRow, number>();
  const rowRawLine = new Map<TableRow, string>();
  let lastRow: TableRow | null = null;
  let lastColumnCellIdx = headerIdx;
  // A label-only line waiting to forward-attach onto the next row. `attached` is true once its text
  // reached any row (backward or forward); a line that reaches none is kept as unqualified flat
  // text, so nothing inside the block is lost (cheap review of #5430 r1: the remainder drops every
  // line between the header and the last column-cell line).
  let pendingLabelOnly: { y: number; idx: number; text: string; attached: boolean } | null = null;
  let scanEnd = windowEnd;

  const wordCount = (s: string): number => (s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length);
  const releasePending = (): void => {
    if (pendingLabelOnly && !pendingLabelOnly.attached) unqualified.push(pendingLabelOnly.text);
    pendingLabelOnly = null;
  };

  for (let i = headerIdx + 1; i < windowEnd; i++) {
    const line = lines[i];
    if (isHeaderLine(line)) {
      scanEnd = i;
      break;
    }
    if (i > headerIdx + 1 && lines[i - 1].y - line.y > hardStopGap) {
      scanEnd = i;
      break;
    }

    const { labelItems, valueItems } = splitLabelValue(line, cols);

    if (valueItems.length === 0) {
      const text = renderItems(labelItems);
      if (/^\d+$/.test(text)) continue; // pure-number footnote mark: dropped
      // Backward attach onto the already-built lastRow (independent of forward attach below).
      let attached = false;
      if (lastRow) {
        const lastRowY = rowLines.get(lastRow) ?? -Infinity;
        const gapOk = lastRowY - line.y <= ATTACH_BAND_PT;
        if (gapOk && (wordCount(lastRow.label) < 2 || tableUnit(text) !== null)) {
          lastRow.label = `${lastRow.label} ${text}`.trim();
          attached = true;
        }
      }
      releasePending();
      pendingLabelOnly = { y: line.y, idx: i, text, attached };
      continue;
    }

    // Continuation of lastRow?
    const labelText = renderItems(labelItems);
    const continuationShape = labelItems.length === 0 || /^[a-z]/.test(labelText);
    if (lastRow && continuationShape) {
      const lastRowY = rowLines.get(lastRow) ?? -Infinity;
      const gapOk = lastRowY - line.y <= ATTACH_BAND_PT;
      const numberShaped = valueItems.every((it) => isNumberShaped(it.str.trim()));
      if (gapOk && wordCount(lastRow.label) >= 2 && !numberShaped) {
        if (lastRow.merged) {
          const extra = renderItems(valueItems);
          for (const c of lastRow.cells) c.value = `${c.value} ${extra}`.trim();
        } else {
          // Each run (not each raw item) is one column, by its LEFT edge — a fragmented cell
          // must stay together in the column its first fragment started in. If a continuation
          // line puts two runs in the same column, they append in x order (Codex #5429 r1 F1).
          for (const run of groupRuns(valueItems, RUN_GAP_PT)) {
            const text = renderItems(run.items);
            if (!text) continue;
            const col = nearestColumn(run.leftX, cols);
            lastRow.cells[col].value = `${lastRow.cells[col].value} ${text}`.trim();
          }
        }
        if (labelText) lastRow.label = `${lastRow.label} ${labelText}`.trim();
        rowLines.set(lastRow, line.y);
        lastColumnCellIdx = i;
        continue;
      }
    }

    // Fresh row by RUN count (merged / per-model / unqualified) — grouping fragments into runs
    // before counting lets a multi-fragment cell still qualify as "exactly n columns", and a
    // run-count of n that still collapses onto fewer than n distinct columns is rejected rather
    // than mis-assigned (Codex #5429 r1 F1).
    const built = labelAndUnit(labelItems);
    const valueRuns = groupRuns(valueItems, RUN_GAP_PT);
    let freshRow: TableRow | null = null;
    if (valueRuns.length === 1) {
      const value = renderItems(valueRuns[0].items);
      freshRow = { label: built.label, unit: built.unit, merged: true, cells: models.map((m) => ({ model: m, value })) };
    } else if (valueRuns.length === n) {
      const colOf = valueRuns.map((r) => nearestColumn(r.leftX, cols));
      if (new Set(colOf).size === n) {
        const valueByCol = new Map<number, string>(colOf.map((col, idx) => [col, renderItems(valueRuns[idx].items)]));
        freshRow = {
          label: built.label,
          unit: built.unit,
          merged: false,
          cells: models.map((m, idx) => ({ model: m, value: valueByCol.get(idx) ?? "" })),
        };
      }
    }

    if (freshRow) {
      // Forward attach: a pending label-only line (above, within band) whose text applies
      // because THIS row's own (pre-attach) label has < 2 words, or the pending text is
      // itself a recognised unit token.
      if (pendingLabelOnly) {
        const gapOk = pendingLabelOnly.y - line.y <= ATTACH_BAND_PT;
        if (gapOk && (wordCount(freshRow.label) < 2 || tableUnit(pendingLabelOnly.text) !== null)) {
          freshRow.label = `${freshRow.label} ${pendingLabelOnly.text}`.trim();
          pendingLabelOnly.attached = true;
        }
        releasePending();
      }
      // An empty label here isn't necessarily final: a label-only line further down may still
      // backward-attach onto this row (see above) before the loop ends. Defer the "empty label
      // after assembly is unqualified" decision to the end, keeping the row's own source line so
      // it can still be reported as flat text if no label ever arrives.
      rows.push(freshRow);
      rowLines.set(freshRow, line.y);
      rowRawLine.set(freshRow, renderItems(line.items));
      lastRow = freshRow;
    } else {
      unqualified.push(renderItems(line.items));
    }
    lastColumnCellIdx = i;
  }

  // A pending line above the last column-cell line is inside the block (the remainder will drop
  // it); one below it is outside and the remainder keeps it as-is.
  if (pendingLabelOnly && pendingLabelOnly.idx < lastColumnCellIdx) releasePending();

  const finalRows: TableRow[] = [];
  for (const r of rows) {
    if (r.label.trim() === "") unqualified.push(rowRawLine.get(r) ?? r.label);
    else finalRows.push(r);
  }

  const caption = captionFor(lines, headerIdx, cols);
  const top = header.y;
  const bottom = lines[lastColumnCellIdx].y;
  return {
    block: { caption, header: headerLabel, models, modelKeys, rows: finalRows, unqualified, top, bottom },
    nextIdx: scanEnd,
  };
}

/** Finds every model-column table on a page. Deterministic; the only shape test used anywhere
 *  is "an identifier cell" (letters AND digits, >=5 chars, no spaces). */
export function detectModelTables(items: readonly LayoutItem[]): TableBlock[] {
  const lines = buildLines(items);
  const blocks: TableBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isHeaderLine(lines[i])) {
      const { block, nextIdx } = buildBlock(lines, i);
      blocks.push(block);
      i = Math.max(nextIdx, i + 1);
    } else {
      i++;
    }
  }
  return blocks;
}

/** manual-rag.ts's `buildGroundedContext` truncates a chunk's rendered content at
 *  `MAX_CONTENT_CHARS` (1200) — before this fix `tableChunks` stored one chunk per model holding
 *  EVERY row, so a long table's trailing rows were silently dropped from what the model sees
 *  (Codex #5429 r1 F4). Split at this smaller, headroom-leaving limit instead, so the eventual
 *  1200-char truncation downstream never lands inside a table chunk. */
const TABLE_CHUNK_MAX_CHARS = 1000;

/** Splits `rowLines` across one or more chunk texts, each starting with `prefix` (continuation
 *  chunks get " (cont.)" appended), never exceeding `TABLE_CHUNK_MAX_CHARS` EXCEPT when a single
 *  row line is itself longer than the budget — that row still goes in its own chunk whole, never
 *  split mid-row. `currentLen` tracks the exact length the serialised `${lines.join("\n")}\n` text
 *  will have, so the limit is exact, not approximate. */
function splitRowsIntoChunks(prefix: string, rowLines: readonly string[]): string[] {
  if (rowLines.length === 0) return [`${prefix}\n`];
  const texts: string[] = [];
  let header = prefix;
  let lines: string[] = [header];
  let currentLen = header.length + 1;
  for (const line of rowLines) {
    const lineLen = line.length + 1;
    if (lines.length > 1 && currentLen + lineLen > TABLE_CHUNK_MAX_CHARS) {
      texts.push(`${lines.join("\n")}\n`);
      header = `${prefix} (cont.)`;
      lines = [header];
      currentLen = header.length + 1;
    }
    lines.push(line);
    currentLen += lineLen;
  }
  texts.push(`${lines.join("\n")}\n`);
  return texts;
}

/** Serialises one table block into one or more chunks per model column (split at row boundaries,
 *  never mid-row, when the model's full text would exceed `TABLE_CHUNK_MAX_CHARS`), plus one or
 *  more chunks of its unqualified (flat-text) lines tagged with every model in the block. Each
 *  model chunk names only its own model and carries only that model's values — never another
 *  model's column. The unqualified chunk's values are nobody's in particular: retrieval
 *  (manual-rag.ts admit) withholds it from a record that holds a catalog number and reports it
 *  as unresolved, so an unreadable line of the record's own table never answers for it. */
export function tableChunks(block: TableBlock): TableChunk[] {
  const prefix = [block.caption, block.header].filter((s) => s.trim().length > 0).join(" — ");
  const chunks: TableChunk[] = [];
  for (let i = 0; i < block.models.length; i++) {
    const model = block.models[i];
    const key = block.modelKeys[i];
    const modelPrefix = prefix ? `${prefix} — ${model}` : model;
    const rowLines: string[] = [];
    for (const r of block.rows) {
      const c = r.cells.find((x) => x.model === model);
      if (!c) continue;
      const unitSuffix = r.unit ? ` ${r.unit}` : "";
      rowLines.push(`${model}: ${r.label} ${c.value}${unitSuffix}`);
    }
    for (const text of splitRowsIntoChunks(modelPrefix, rowLines)) chunks.push({ text, models: [key], unqualified: false });
  }
  if (block.unqualified.length > 0) {
    const unqualifiedPrefix = prefix ? `${prefix} — unqualified` : "unqualified";
    for (const text of splitRowsIntoChunks(unqualifiedPrefix, block.unqualified)) {
      chunks.push({ text, models: [...block.modelKeys], unqualified: true });
    }
  }
  return chunks;
}

/** Finds every MODEL-KEYED table on a page (#5450): a run of >= MODEL_KEYED_MIN_LINES lines, each
 *  with exactly one identifier cell that is the line's LEFTMOST item at one shared x, beside >= 1
 *  value item, every value number-shaped; interior lines of bare numbers (a merged Ø mark printed
 *  at the centre of its span) are allowed and a gap > BLOCK_GAP_MULT × the run's median pitch, a
 *  prose word, a second identifier, or a line inside `occupied` (a header-row block) ends it. The
 *  run must start beneath a line with no identifier cell (its header band, which is part of the
 *  table when its gaps are tight). Across the three pilot manuals (GS10 454 pages, Micro820 24,
 *  relay 4) this fires on exactly one page, GS10 p.394. Nothing is parsed into rows — see
 *  `ModelKeyedTable`. */
function detectModelKeyedTables(lines: readonly Line[], occupied: ReadonlySet<number>): ModelKeyedTable[] {
  const tables: ModelKeyedTable[] = [];
  const isValueItem = (it: LayoutItem): boolean => isNumberShaped(it.str);
  // Codex r1 on #5451 (F1): the key cell must READ as a model number — by the same reader the
  // record's number and a manual's cover are read with (manual-applicability.ts) — not merely be
  // identifier-shaped. "P06.63" (a parameter code) is identifier-shaped but reads as no model, so a
  // Parameter / Default / Min / Max table stays ordinary text instead of a tagged, withheld block.
  const keyedLine = (line: Line): LayoutItem | null => {
    const ids = identifierCells(line);
    if (ids.length !== 1 || line.items[0] !== ids[0] || line.items.length < 2) return null;
    if (modelNumbersIn(ids[0].str).length === 0) return null;
    return line.items.slice(1).every(isValueItem) ? ids[0] : null;
  };
  const bareNumberLine = (line: Line): boolean => identifierCells(line).length === 0 && line.items.every(isValueItem);

  let i = 0;
  while (i < lines.length) {
    const first = occupied.has(i) ? null : keyedLine(lines[i]);
    // A key column starts beneath its header band: a run whose line above carries an identifier
    // cell is the tail of a table the reader could not qualify (GS10 p.227 — P06.17–P06.22 with
    // fault-code cells, then P06.63–P06.70 with numeric cells), not a table of its own.
    if (!first || (i > 0 && identifierCells(lines[i - 1]).length > 0)) {
      i++;
      continue;
    }
    const modelIdx: number[] = [i];
    const gaps: number[] = [];
    let j = i + 1;
    for (; j < lines.length && !occupied.has(j); j++) {
      const gap = lines[j - 1].y - lines[j].y;
      const medianGap = gaps.length > 0 ? median(gaps) : 12;
      if (gap > BLOCK_GAP_MULT * Math.max(medianGap, 1)) break;
      const key = keyedLine(lines[j]);
      if (key) {
        if (Math.abs(key.x - first.x) > MODEL_KEY_X_TOL_PT) break;
        gaps.push(lines[modelIdx[modelIdx.length - 1]].y - lines[j].y);
        modelIdx.push(j);
        continue;
      }
      if (!bareNumberLine(lines[j])) break;
    }
    if (modelIdx.length < MODEL_KEYED_MIN_LINES) {
      i++;
      continue;
    }
    const last = modelIdx[modelIdx.length - 1];
    const pitch = median(gaps);
    let start = i;
    while (start > 0 && !occupied.has(start - 1)) {
      const above = lines[start - 1];
      if (identifierCells(above).length > 0 || above.y - lines[start].y > MODEL_KEYED_HEADER_GAP_MULT * pitch) break;
      start--;
    }
    const models = modelIdx.map((idx) => keyedLine(lines[idx])!.str.trim());
    const distinct = [...new Set(models)];
    const rendered = lines.slice(start, last + 1).map((l) => renderItems(l.items));
    const caption = start < i ? rendered[0] : "";
    tables.push({
      caption,
      lines: start < i ? rendered.slice(1) : rendered,
      models: distinct,
      modelKeys: distinct.map(exactModelKey),
      top: lines[start].y,
      bottom: lines[last].y,
    });
    i = last + 1;
  }
  return tables;
}

/** Reads a page's positioned text items, finds every qualifying model-column table, and returns
 *  the chunked tables plus the page's remaining text with those table lines excluded. A block
 *  qualifies with >= 2 rows (so a bare label/value sheet like the Schneider data sheet is never
 *  mistaken for one) of which >= 1 is per-model (cells that differ by column): a block whose every
 *  row is one merged value carries no column information, and that is exactly the shape a sentence
 *  with two model numbers as separate items plus a few trailing numbers takes (cheap review of
 *  #5430 r1 — without this rule such a "table" swallowed the whole page into chunks).
 *  A MODEL-KEYED table (`detectModelKeyedTables`, #5450) also qualifies, as unqualified text only.
 *  Returns null when the page has no qualifying table (the remainder is then just the page as-is,
 *  which callers already have via the flat-text path). */
export function pageWithTables(items: readonly LayoutItem[]): { remainder: string; chunks: TableChunk[] } | null {
  const blocks = detectModelTables(items).filter((b) => b.rows.length >= 2 && b.rows.some((r) => !r.merged));
  const lines = buildLines(items);
  const occupied = new Set<number>();
  lines.forEach((l, idx) => {
    if (blocks.some((b) => l.y <= b.top && l.y >= b.bottom)) occupied.add(idx);
  });
  const keyed = detectModelKeyedTables(lines, occupied);
  if (blocks.length === 0 && keyed.length === 0) return null;

  const chunks: TableChunk[] = [];
  for (const block of blocks) chunks.push(...tableChunks(block));
  // A model-keyed table is ONE unqualified chunk (split only by the size budget) tagged with every
  // model of its key column, so retrieval withholds it from a record holding a catalog number and
  // reports the page as unresolved — a flat `GS11N-20P2 230 1.8` line never answers for a value
  // again (#5450). No per-model chunk is written: nothing was tied to a column.
  for (const t of keyed) {
    const prefix = t.caption ? `${t.caption} — unqualified` : "unqualified";
    for (const text of splitRowsIntoChunks(prefix, t.lines)) chunks.push({ text, models: [...t.modelKeys], unqualified: true });
  }

  const spans = [...blocks.map((b) => ({ top: b.top, bottom: b.bottom })), ...keyed.map((t) => ({ top: t.top, bottom: t.bottom }))];
  const kept = lines.filter((l) => !spans.some((s) => l.y <= s.top && l.y >= s.bottom));
  const remainder = kept.map((l) => renderItems(l.items)).join("\n");
  return { remainder, chunks };
}
