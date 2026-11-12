/**
 * Table rows at upload (garage pilot, plan row 1-A; ledger L3/L4/L5).
 *
 * See `table-rows.test.ts`'s header comment for the full rules — that comment IS the spec this
 * file implements literally. Pure, deterministic, zero tokens: no model call, no vendor-shape
 * regex (the only shape test is "an identifier cell": letters AND digits, >=5 chars, no spaces).
 */
import { tableUnit } from "./supporting-quote";

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

/** A line: items already sorted left-to-right (x ascending), with a representative y. */
interface Line {
  y: number;
  items: LayoutItem[];
}

const LINE_GAP_PT = 2.5;
const CAPTION_BAND_PT = 40;
const ATTACH_BAND_PT = 14;
const BLOCK_GAP_MULT = 3;

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
          for (const it of valueItems) {
            const col = nearestColumn(it.x, cols);
            lastRow.cells[col].value = `${lastRow.cells[col].value} ${it.str.trim()}`.trim();
          }
        }
        if (labelText) lastRow.label = `${lastRow.label} ${labelText}`.trim();
        rowLines.set(lastRow, line.y);
        lastColumnCellIdx = i;
        continue;
      }
    }

    // Fresh row by count (merged / per-model / unqualified).
    const built = labelAndUnit(labelItems);
    let freshRow: TableRow | null = null;
    if (valueItems.length === 1) {
      const value = valueItems[0].str.trim();
      freshRow = { label: built.label, unit: built.unit, merged: true, cells: models.map((m) => ({ model: m, value })) };
    } else if (valueItems.length === n) {
      freshRow = {
        label: built.label,
        unit: built.unit,
        merged: false,
        cells: models.map((m, idx) => ({ model: m, value: valueItems[idx].str.trim() })),
      };
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

/** Serialises one table block into one chunk per model column, plus one chunk of its unqualified
 *  (flat-text) lines tagged with every model in the block. Each model chunk names only its own
 *  model and carries only that model's values — never another model's column. */
export function tableChunks(block: TableBlock): TableChunk[] {
  const prefix = [block.caption, block.header].filter((s) => s.trim().length > 0).join(" — ");
  const chunks: TableChunk[] = [];
  for (let i = 0; i < block.models.length; i++) {
    const model = block.models[i];
    const key = block.modelKeys[i];
    const lines: string[] = [prefix ? `${prefix} — ${model}` : model];
    for (const r of block.rows) {
      const c = r.cells.find((x) => x.model === model);
      if (!c) continue;
      const unitSuffix = r.unit ? ` ${r.unit}` : "";
      lines.push(`${model}: ${r.label} ${c.value}${unitSuffix}`);
    }
    chunks.push({ text: `${lines.join("\n")}\n`, models: [key], unqualified: false });
  }
  if (block.unqualified.length > 0) {
    const lines = [prefix ? `${prefix} — unqualified` : "unqualified", ...block.unqualified];
    chunks.push({ text: `${lines.join("\n")}\n`, models: [...block.modelKeys], unqualified: true });
  }
  return chunks;
}

/** Reads a page's positioned text items, finds every qualifying model-column table, and returns
 *  the chunked tables plus the page's remaining text with those table lines excluded. A block
 *  qualifies with >= 2 rows (so a bare label/value sheet like the Schneider data sheet is never
 *  mistaken for one) of which >= 1 is per-model (cells that differ by column): a block whose every
 *  row is one merged value carries no column information, and that is exactly the shape a sentence
 *  with two model numbers as separate items plus a few trailing numbers takes (cheap review of
 *  #5430 r1 — without this rule such a "table" swallowed the whole page into chunks).
 *  Returns null when the page has no qualifying table (the remainder is then just the page as-is,
 *  which callers already have via the flat-text path). */
export function pageWithTables(items: readonly LayoutItem[]): { remainder: string; chunks: TableChunk[] } | null {
  const blocks = detectModelTables(items).filter((b) => b.rows.length >= 2 && b.rows.some((r) => !r.merged));
  if (blocks.length === 0) return null;

  const lines = buildLines(items);
  const chunks: TableChunk[] = [];
  for (const block of blocks) chunks.push(...tableChunks(block));

  const kept = lines.filter((l) => !blocks.some((b) => l.y <= b.top && l.y >= b.bottom));
  const remainder = kept.map((l) => renderItems(l.items)).join("\n");
  return { remainder, chunks };
}
