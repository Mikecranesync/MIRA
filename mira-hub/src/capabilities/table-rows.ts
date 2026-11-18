/**
 * Table rows at upload (garage pilot, plan row 1-A; ledger L3/L4/L5).
 *
 * See `table-rows.test.ts`'s header comment for the full rules — that comment IS the spec this
 * file implements literally. Pure, deterministic, zero tokens: no model call, no vendor-shape
 * regex (the only shape test is "an identifier cell": letters AND digits, >=5 chars, no spaces).
 */
import { findValues, tableUnit } from "./supporting-quote";
import { hasNegation, modelNumbersIn } from "./manual-applicability";
import { catalogIdentifierView } from "./catalog-identifier";

/** `vr`: indices of the page's painted vertical rules crossing this item's baseline (absent = no rule evidence); `vrx`: those rules' x positions, index-aligned. */
/** `vertical`: the PDF sets this text rotated 90 degrees counter-clockwise; it then reads upward from (x, y) and `w` is its length along y. */
export type LayoutItem = { str: string; x: number; y: number; w: number; size: number; vr?: readonly number[]; vrx?: readonly number[]; vertical?: boolean };
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
  bodySize?: number;
  rowYs?: number[];
  memberYs?: number[];
};
export type TableChunk = { text: string; models: string[]; unqualified: boolean; sourceTop?: number; sourceBottom?: number; sourceHeaderSize?: number; sourceBodySize?: number; sourceRowYs?: number[]; sourceMemberYs?: number[]; sourceCaption?: string; sourceModels?: string[]; scope?: "unresolved" };
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
/** A table's frame edge, or the separator left of an unlabelled first model cell, sits within a cell padding of the header text. */
const RULE_EDGE_PT = 8;
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

/** Ordinary keyed data stays ordinary (#5451). A fresh, physically proven
 * parameter grid can end an earlier column-only domain, without assigning
 * equipment identities or extracting its values into model columns. */
export function ordinaryKeyedTableHeaders(items: readonly LayoutItem[]): number[] {
  const lines = buildLines(items);
  const tops: number[] = [];
  const numeric = (item: LayoutItem) => isNumberShaped(item.str) || /^(?:0x)?(?=[0-9a-f]*\d)[0-9a-f]+$/i.test(item.str.trim());
  for (let i = 1; i + 2 < lines.length; i++) {
    const header = lines[i - 1];
    const first = lines[i].items[0];
    if (!isIdentifierCell(first.str) || modelNumbersIn(first.str).length > 0 || identifierCells(header).length > 0 ||
        modelNumbersIn(catalogIdentifierView(renderItems(header.items)).text).length > 0 ||
        header.items.some(numeric) || findValues(renderItems(header.items), "source").length > 0) continue;
    const fields = groupRuns(header.items, RUN_GAP_PT).map((run) => run.leftX).filter((x) => x > first.x + MODEL_KEY_X_TOL_PT);
    if (fields.length < 2) continue;
    const tolerance = Math.max(6, median(fields.slice(1).map((x, j) => x - fields[j])) * 0.15);
    const columnOf = (x: number) => fields.findIndex((field) => Math.abs(field - x) <= tolerance);
    const keys = new Set<string>();
    const pitch = Math.max(1, header.y - lines[i].y);
    const proven = lines.slice(i, i + MODEL_KEYED_MIN_LINES).every((line, j) => {
      const key = line.items[0];
      if (!isIdentifierCell(key.str) || modelNumbersIn(key.str).length > 0 || Math.abs(key.x - first.x) > MODEL_KEY_X_TOL_PT ||
          (j > 0 && lines[i + j - 1].y - line.y > BLOCK_GAP_MULT * pitch)) return false;
      keys.add(key.str.trim());
      const values = line.items.slice(1).filter(numeric);
      const columns = values.map((value) => columnOf(value.x));
      return values.length >= 2 && columns.every((column) => column >= 0) && new Set(columns).size === values.length &&
        line.items.slice(1).every((item) => item.x < fields[0] - tolerance || columnOf(item.x) >= 0);
    });
    if (proven && keys.size >= MODEL_KEYED_MIN_LINES) tops.push(header.y);
  }
  return tops;
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

/** A stub cell: a label printed once beside the rows it applies to, either rotated text naming
 *  a group of rows ("Output Rating") or one of a column of short duty labels ("CT", "VT"). */
type Stub = { item: LayoutItem; kind: "group" | "duty"; centre: number; right: number };
/** Where a built row sits: first and last baselines, and the leftmost x of its label text. */
type RowSpan = { top: number; bottom: number; labelX: number };
const isFootnoteMark = (text: string): boolean => /^\d{1,2}$/.test(text);
/** A footnote mark is printed smaller than the table's text: on GS10 pages 26 and 27 the rotated
 *  "2" is 5 pt where the table's upright text has a median of 8 pt (0.625). A full-size digit is
 *  a label, not a mark. */
const SUPERSCRIPT_RATIO = 0.8;
/** Where a superscript mark sits relative to the rotated label it annotates. GS10 pages 26 and 27:
 *  the "2" is raised 2.83 pt off "Input Rating"'s baseline and starts exactly where that label's
 *  text ends. A digit on the label's own baseline is not raised, so it is not a superscript. */
const MARK_RAISE_MIN_PT = 0.5;
const MARK_RAISE_MAX_PT = 6;
const MARK_END_TOLERANCE_PT = 2;
/** A rotated item names a group unless it is a footnote mark. A mark is one or two digits,
 *  surrounding space ignored, printed at under SUPERSCRIPT_RATIO of `bodySize` (the median size of
 *  the table's upright text), raised off a rotated word label's baseline and starting where that
 *  label's text ends: positive evidence that it annotates the label. Any other rotated digit, small
 *  or not, is a group label: placed if it centres on its rows, otherwise the rows are withheld with
 *  its text kept. A real PDF also rotates empty and space items beside a rotated label;
 *  `buildLines` drops those. A mark is read as ordinary label text, as if upright (#5615 Codex F1,
 *  F3, F4, F5, F7). */
function isGroupStub(it: LayoutItem, bodySize: number, rotatedLabels: readonly LayoutItem[]): boolean {
  if (it.vertical !== true) return false;
  if (!isFootnoteMark(it.str.trim())) return true;
  if (it.size >= SUPERSCRIPT_RATIO * bodySize) return true;
  return !rotatedLabels.some((l) => {
    const raise = Math.abs(it.x - l.x);
    return raise >= MARK_RAISE_MIN_PT && raise <= MARK_RAISE_MAX_PT && Math.abs(it.y - (l.y + l.w)) <= MARK_END_TOLERANCE_PT;
  });
}

/** Rotated items that hold label text: the labels a footnote mark can annotate. */
function rotatedWordLabels(window: readonly Line[]): LayoutItem[] {
  return window.flatMap((l) => l.items).filter((it) => it.vertical === true && /[A-Za-z]/.test(it.str));
}

function medianUprightSize(window: readonly Line[]): number {
  const sizes = window.flatMap((l) => l.items).filter((it) => it.vertical !== true).map((it) => it.size).sort((x, y) => x - y);
  if (sizes.length === 0) return 0;
  const mid = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 1 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2;
}

/** Stub cells in a block's label area, read from text geometry alone. A rotated item is a group
 *  stub. A duty stub is a single-word, non-unit first label run; it counts only as a COLUMN: two or
 *  more share one x, no multi-word label starts at that x, and at least one of them is followed on
 *  its own line by more label text. A lone short label, or a column of one-word labels, is not one. */
/** Bound on stub-placement work (stubs x rows x rows): far above any printed table, so a page
 *  built to exhaust the reader is withheld instead of stalling the upload (#5598 Codex F1). */
const STUB_PLACEMENT_WORK = 2_000_000;

function findStubs(window: readonly Line[], cols: Columns): Stub[] {
  const out: Stub[] = [];
  const duty: Array<Stub & { followed: boolean }> = [];
  const labelStarts: Array<{ x: number; words: number }> = [];
  const bodySize = medianUprightSize(window);
  const rotatedLabels = rotatedWordLabels(window);
  for (const line of window) {
    const { labelItems } = splitLabelValue(line, cols);
    for (const it of labelItems) if (isGroupStub(it, bodySize, rotatedLabels)) out.push({ item: it, kind: "group", centre: it.y + it.w / 2, right: it.x });
    const runs = groupRuns(labelItems.filter((it) => !isGroupStub(it, bodySize, rotatedLabels)), RUN_GAP_PT).filter((r) => !isFootnoteMark(renderItems(r.items)));
    for (const r of runs) labelStarts.push({ x: r.leftX, words: renderItems(r.items).split(/\s+/).length });
    const first = runs[0];
    if (!first || first.items.length !== 1) continue;
    const text = renderItems(first.items);
    if (/\s/.test(text) || tableUnit(text) !== null) continue;
    const followed = runs.slice(1).some((r) => tableUnit(renderItems(r.items)) === null);
    const it = first.items[0];
    duty.push({ item: it, kind: "duty", centre: line.y, right: it.x + it.w, followed });
  }
  for (const s of duty) {
    const column = duty.filter((o) => Math.abs(o.item.x - s.item.x) <= 2);
    const labelAtX = labelStarts.some((l) => l.words > 1 && Math.abs(l.x - s.item.x) <= 2);
    if (column.length >= 2 && !labelAtX && column.some((o) => o.followed)) out.push({ item: s.item, kind: s.kind, centre: s.centre, right: s.right });
  }
  return out;
}

/** Apply stubs to the rows they span. For each kind, the rows whose label starts right of the
 *  stubs form contiguous runs; each run holding stubs is split into one consecutive segment per
 *  stub, and the split is accepted only when it is the ONLY one whose every segment is centred on
 *  its stub. Anything else (a stub beside no run, no split, two splits) fails closed: every row the
 *  stubs of that kind could label is returned for demotion, never left unlabelled as a value. */
function placeStubs(rows: readonly TableRow[], span: ReadonlyMap<TableRow, RowSpan>, stubs: readonly Stub[]):
    { prefix: Map<TableRow, string[]>; demote: Set<TableRow>; placed: Map<Stub, TableRow[]>; unplaced: Stub[] } {
  const prefix = new Map<TableRow, string[]>();
  const demote = new Set<TableRow>();
  const placed = new Map<Stub, TableRow[]>();
  const unplaced: Stub[] = [];
  const tops = rows.map((r) => span.get(r)!.top);
  const pitch = tops.length >= 2 ? median(tops.slice(1).map((t, i) => tops[i] - t).filter((g) => g > 0)) || 12 : 12;
  const tol = 0.35 * pitch;
  for (const kind of ["group", "duty"] as const) {
    const own = stubs.filter((s) => s.kind === kind).sort((a, b) => b.centre - a.centre);
    if (own.length === 0) continue;
    const edge = Math.max(...own.map((s) => s.right)) - 0.5;
    // A label that is one unit word ("kW" printed beside "Max Motor Output") is a unit cell of a
    // neighbouring row, not a row of its own: it neither starts nor breaks a run, and it takes
    // the stub of the row it continues, the row above, when that row has one. Never the row
    // below: a unit printed under one property's cell must not take the next property's duty.
    const unitOnly = (r: TableRow) => /^\S+$/.test(r.label.trim()) && tableUnit(r.label.trim()) !== null;
    const inColumn = (r: TableRow) => span.get(r)!.labelX >= edge && !unitOnly(r);
    const eligible = rows.filter(inColumn);
    const runs: TableRow[][] = [];
    let previous: TableRow | null = null;
    for (const r of rows) {
      if (unitOnly(r)) continue;
      if (!inColumn(r)) { previous = r; continue; }
      if (previous !== null && runs.length > 0 && runs[runs.length - 1].at(-1) === previous) runs[runs.length - 1].push(r);
      else runs.push([r]);
      previous = r;
    }
    const offset = (s: Stub) => (s.kind === "group" ? 0.3 * s.item.size : 0);
    const byRun = new Map<TableRow[], Stub[]>();
    let failed = false;
    for (const s of own) {
      const run = runs.find((r) => s.centre <= span.get(r[0])!.top + pitch / 2 + offset(s) && s.centre >= span.get(r[r.length - 1])!.bottom - pitch / 2);
      if (!run) { failed = true; break; }
      byRun.set(run, [...(byRun.get(run) ?? []), s]);
    }
    const assigned: Array<[TableRow, string]> = [];
    const rowsOf = new Map<Stub, TableRow[]>();
    for (const [run, ss] of failed ? [] : byRun) {
      // Count the centred splits, capped at two, by dynamic programming over (stub, first row):
      // ways[j][from] = splits of run[from..] into one segment per stub j.. (#5598 Codex F1: the
      // exhaustive search was exponential). Work beyond the limit fails closed, like two splits.
      const n = run.length;
      const k = ss.length;
      if (k * n * n > STUB_PLACEMENT_WORK) { failed = true; break; }
      const fits = (j: number, from: number, to: number) =>
        Math.abs((span.get(run[from])!.top + span.get(run[to - 1])!.bottom) / 2 + offset(ss[j]) - ss[j].centre) <= tol;
      const ways: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
      ways[k][n] = 1;
      for (let j = k - 1; j >= 0; j--) {
        for (let from = 0; from < n; from++) {
          let count = 0;
          for (let to = from + 1; to <= n && count < 2; to++) if (ways[j + 1][to] > 0 && fits(j, from, to)) count += ways[j + 1][to];
          ways[j][from] = Math.min(count, 2);
        }
      }
      if (ways[0][0] !== 1) { failed = true; break; }
      let from = 0;
      for (let j = 0; j < k; j++) {
        let to = from + 1;
        while (!(ways[j + 1][to] > 0 && fits(j, from, to))) to++;
        for (const r of run.slice(from, to)) assigned.push([r, renderItems([ss[j].item])]);
        rowsOf.set(ss[j], run.slice(from, to));
        from = to;
      }
    }
    if (failed) { for (const r of eligible) demote.add(r); unplaced.push(...own); continue; }
    const stubOf = new Map(assigned);
    rows.forEach((r, i) => {
      if (!unitOnly(r)) return;
      let j = i - 1;
      while (rows[j] && unitOnly(rows[j])) j -= 1;
      const text = rows[j] ? stubOf.get(rows[j]) : undefined;
      if (text) assigned.push([r, text]);
    });
    for (const [r, text] of assigned) prefix.set(r, [...(prefix.get(r) ?? []), text]);
    for (const [stub, labelled] of rowsOf) placed.set(stub, labelled);
  }
  return { prefix, demote, placed, unplaced };
}

/** Build one TableBlock starting at `lines[headerIdx]`. Returns the block and the index of the
 *  first line NOT consumed by it (where the outer scan should resume). */
function buildBlock(sourceLines: readonly Line[], headerIdx: number): { block: TableBlock; nextIdx: number } {
  let lines = sourceLines;
  const header = lines[headerIdx];
  /** Painted vertical rules crossing EVERY printed item of a line. */
  const rulesOf = (l: Line): readonly number[] => l.items.filter((item) => item.str.trim().length > 0)
    .reduce<readonly number[] | null>((common, item) => {
      const own = item.vr ?? [];
      return common === null ? own : common.filter((id) => own.includes(id));
    }, null) ?? [];
  // Painted rules of THIS header, by x. A separator lies between its cells: right of the label
  // cell (or just left of the first model cell when no label is printed) and left of the header's
  // right end. A rule outside that is at most a frame edge, and one edge alone proves nothing - a
  // margin or revision bar looks the same - so the frame counts only as a left and right pair.
  const printed = header.items.filter((item) => item.str.trim().length > 0);
  const headerLeft = Math.min(...printed.map((item) => item.x));
  const headerRight = Math.max(...printed.map((item) => item.x + item.w));
  const firstModelLeft = Math.min(...printed.filter((item) => isIdentifierCell(item.str)).map((item) => item.x));
  const labelCells = printed.filter((item) => item.x < firstModelLeft);
  const labelRight = labelCells.length > 0 ? Math.max(...labelCells.map((item) => item.x + item.w)) : firstModelLeft - RULE_EDGE_PT;
  const ruleX = (id: number): number => {
    const item = printed.find((candidate) => candidate.vr?.includes(id));
    return item?.vrx?.[item.vr!.indexOf(id)] ?? Number.NaN;
  };
  const crossingHeader = rulesOf(header);
  const separators = crossingHeader.filter((id) => ruleX(id) > labelRight && ruleX(id) < headerRight);
  const frameLeft = crossingHeader.filter((id) => ruleX(id) <= headerLeft && ruleX(id) > headerLeft - RULE_EDGE_PT);
  const frameRight = crossingHeader.filter((id) => ruleX(id) >= headerRight && ruleX(id) < headerRight + RULE_EDGE_PT);
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
  // Stub cells leave their lines here and are applied to the rows they span after the scan.
  const stubs = findStubs(window, cols);
  if (stubs.length > 0) {
    const stubItems = new Set(stubs.map((s) => s.item));
    lines = sourceLines.map((l, i) => (i <= headerIdx || i >= windowEnd ? l : { y: l.y, items: l.items.filter((it) => !stubItems.has(it)) }));
  }

  const gaps: number[] = [];
  for (let i = headerIdx; i + 1 < windowEnd; i++) gaps.push(lines[i].y - lines[i + 1].y);
  const medianGap = gaps.length > 0 ? median(gaps) : 12;
  const hardStopGap = BLOCK_GAP_MULT * Math.max(medianGap, 1);

  const rows: TableRow[] = [];
  const unqualified: string[] = [];
  const rowLines = new Map<TableRow, number>();
  const rowRawLine = new Map<TableRow, string>();
  const rowSpan = new Map<TableRow, RowSpan>();
  const labelStart = (items: readonly LayoutItem[]) => Math.min(...items.filter((it) => !isFootnoteMark(it.str.trim())).map((it) => it.x));
  let bodySize = 0;
  const rowYs: number[] = [];
  const memberYs: number[] = [];
  let lastRow: TableRow | null = null;
  let lastColumnCellIdx = headerIdx;
  // A label-only line waiting to forward-attach onto the next row. `attached` is true once its text
  // reached any row (backward or forward); a line that reaches none is kept as unqualified flat
  // text, so nothing inside the block is lost (cheap review of #5430 r1: the remainder drops every
  // line between the header and the last column-cell line).
  let pendingLabelOnly: { y: number; idx: number; text: string; attached: boolean; x: number } | null = null;
  let scanEnd = windowEnd;

  const wordCount = (s: string): number => (s.trim().length === 0 ? 0 : s.trim().split(/\s+/).length);
  const releasePending = (): void => {
    if (pendingLabelOnly && !pendingLabelOnly.attached) unqualified.push(pendingLabelOnly.text);
    pendingLabelOnly = null;
  };

  /** Positive evidence that line `idx` belongs to this table (never a model scope). */
  const isMemberLine = (line: Line, i: number, continuation = true): boolean => {
    const { labelItems, valueItems } = splitLabelValue(line, cols);
    // Ownership is positive: a line must fit this table's column grid or a
    // bounded data/label/footnote exemption. Nearest-column assignment alone
    // does not prove membership. This evidence is used BEFORE extraction to
    // cut off unrelated text; it never assigns an affirmative model scope.
    const text = renderItems(line.items);
    const catalogs = modelNumbersIn(catalogIdentifierView(text).text);
    const conflicting = catalogs.some((number) => !modelKeys.includes(number.key)) ||
      (catalogs.length > 0 && hasNegation(text));
    const runs = groupRuns(valueItems, RUN_GAP_PT);
    const columns = runs.map((run) => nearestColumn(run.leftX, cols));
    const aligned = runs.length > 0 && runs.every((run, j) => Math.abs(run.leftX - cols.x[columns[j]]) <= cols.tol);
    const gridRow = aligned && new Set(columns).size >= 2 && new Set(columns).size === runs.length;
    const bareLabel = modelKeys.includes(exactModelKey(text)) || line.items.every((item) =>
      isIdentifierCell(item.str) && modelKeys.includes(exactModelKey(item.str)));
    // Centred labels can sit between two baselines of their own multiline
    // value cells. Require overlapping text boxes at this grid's columns;
    // mere adjacency or short label wording is not ownership evidence.
    const centredLabel = labelItems.length > 0 && [lines[i - 1], lines[i + 1]].some((adjacent) => {
      if (!adjacent || Math.abs(adjacent.y - line.y) > Math.min(...line.items.map((item) => item.size)) * 0.75) return false;
      const adjacentCells = splitLabelValue(adjacent, cols);
      return adjacentCells.valueItems.length > 0 &&
        groupRuns(adjacentCells.valueItems, RUN_GAP_PT).every((run) => Math.abs(run.leftX - cols.x[nearestColumn(run.leftX, cols)]) <= cols.tol);
    });
    // F14: a numbered prefix cannot tell a footnote from a numbered section
    // title, and a measurement inside one aligned item cannot tell a merged
    // data cell from a voltage-bearing heading. Wording and position grant
    // nothing beyond a labelled grid row. A centred label, or cells aligned to
    // the columns without a label (a wrapped continuation, a merged cell, a
    // lone marker - or a title set in a column), is this table's only when a
    // painted rule of the model header runs unbroken through the line. A page
    // with no rule evidence gets none. Prose inside the rules stays outside.
    const lineRules = rulesOf(line);
    const through = (ids: readonly number[]) => ids.some((id) => lineRules.includes(id));
    const ruled = through(separators) || (through(frameLeft) && through(frameRight));
    const labelledGridRow = gridRow && labelItems.length > 0;
    // A labelled line whose label and values one of this header's own separators keeps apart,
    // with no value run cut by a rule crossing the line, is a row of this table: a merged or
    // spanning cell sits inside its rules. The frame alone grants nothing.
    const runRight = (run: Run) => Math.max(...run.items.map((it) => it.x + it.w));
    const separatedLabel = labelItems.length > 0 && valueItems.length > 0 && through(separators) &&
      !runs.some((run) => lineRules.some((id) => ruleX(id) > run.leftX + 0.5 && ruleX(id) < runRight(run) - 0.5));
    // The second line of a two-line label ("Rated Input Current" / "(3-phase and 1-phase)"):
    // a parenthetical qualifier only (a numbered footnote or heading is not one), starting at
    // the same x as the label of a member row printed directly
    // above it, within the attach band, inside this header's painted separators (a footnote or
    // a numbered heading outside them never qualifies). Only label words; no value or catalog.
    const labelX = (items: readonly LayoutItem[]) => Math.min(...items.filter((it) => it.str.trim().length > 0).map((it) => it.x));
    const labelLine = continuation && labelItems.length > 0 && valueItems.length === 0 && catalogs.length === 0 && through(separators) &&
      /^\([^()]+\)$/.test(renderItems(labelItems).trim()) &&
      lines.slice(headerIdx + 1, i).some((above, k) => {
        const own = splitLabelValue(above, cols).labelItems.filter((it) => it.str.trim().length > 0);
        return above.y - line.y <= ATTACH_BAND_PT && own.length > 0 && Math.abs(labelX(own) - labelX(labelItems)) <= 1 &&
          isMemberLine(above, headerIdx + 1 + k, false);
      });
    return !conflicting && (labelledGridRow || bareLabel || separatedLabel || labelLine || (ruled && (aligned || centredLabel)));
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
    if (line.items.length === 0) continue; // only stub cells were on it

    const { labelItems, valueItems } = splitLabelValue(line, cols);

    // A footnote mark on its own line is this table's when the line it marks is.
    const markOnly = isFootnoteMark(renderItems(line.items)) && [lines[i - 1], lines[i + 1]].some((adjacent) =>
      adjacent !== undefined && Math.abs(adjacent.y - line.y) <= Math.min(...line.items.map((it) => it.size)) * 0.75 &&
      isMemberLine(adjacent, lines.indexOf(adjacent)));
    if (isMemberLine(line, i) || markOnly) memberYs.push(line.y);

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
          const sp = rowSpan.get(lastRow);
          if (sp) rowSpan.set(lastRow, { ...sp, bottom: line.y, labelX: Math.min(sp.labelX, labelStart(labelItems)) });
        }
      }
      releasePending();
      pendingLabelOnly = { y: line.y, idx: i, text, attached, x: labelStart(labelItems) };
      continue;
    }

    // Calibrate the ordinary value-cell font from its first value-bearing row, not the
    // page minimum (which may be a tiny footnote). A foreign catalog cell is not
    // evidence for ordinary body size: it may be the next section's title.
    if (!modelNumbersIn(renderItems(valueItems)).some((number) => !modelKeys.includes(number.key))) {
      if (bodySize === 0) bodySize = Math.max(...valueItems.map((item) => item.size));
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
        const sp = rowSpan.get(lastRow);
        if (sp) rowSpan.set(lastRow, { ...sp, bottom: line.y, labelX: labelItems.length > 0 ? Math.min(sp.labelX, labelStart(labelItems)) : sp.labelX });
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
    } else if (valueRuns.length > 1 && valueRuns.length < n) {
      // Spanning cells ("Convective" across four models, "Fan" under the fifth): each run is
      // centred on a contiguous span of model headers, and the spans tile every column exactly
      // once, in order. Anything less is not assigned.
      const centre = (left: number, right: number) => (left + right) / 2;
      const runRight = (run: Run) => Math.max(...run.items.map((it) => it.x + it.w));
      const spans: Array<[number, number]> = [];
      let from = 0;
      for (const run of valueRuns) {
        if (from >= n) break;
        const c = centre(run.leftX, runRight(run));
        const to = idCells.findIndex((_, k) => k >= from && Math.abs(centre(idCells[from].x, idCells[k].x + idCells[k].w) - c) <= cols.tol);
        if (to < 0) break;
        spans.push([from, to]);
        from = to + 1;
      }
      if (spans.length === valueRuns.length && from === n) {
        const valueAt = (idx: number) => renderItems(valueRuns[spans.findIndex(([a, b]) => idx >= a && idx <= b)].items);
        freshRow = { label: built.label, unit: built.unit, merged: false, cells: models.map((m, idx) => ({ model: m, value: valueAt(idx) })) };
      }
    }

    if (freshRow) {
      // A full per-model value row remains a row even if its attribute label is
      // bold. Catalog-bearing lines cannot use this exemption as a new heading.
      if (!freshRow.merged && modelNumbersIn(renderItems(line.items)).length === 0) rowYs.push(line.y);
      // Forward attach: a pending label-only line (above, within band) whose text applies
      // because THIS row's own (pre-attach) label has < 2 words, or the pending text is
      // itself a recognised unit token.
      const span: RowSpan = { top: line.y, bottom: line.y, labelX: labelItems.length > 0 ? labelStart(labelItems) : Infinity };
      if (pendingLabelOnly) {
        const gapOk = pendingLabelOnly.y - line.y <= ATTACH_BAND_PT;
        if (gapOk && (wordCount(freshRow.label) < 2 || tableUnit(pendingLabelOnly.text) !== null)) {
          freshRow.label = `${freshRow.label} ${pendingLabelOnly.text}`.trim();
          pendingLabelOnly.attached = true;
          span.top = pendingLabelOnly.y;
          span.labelX = Math.min(span.labelX, pendingLabelOnly.x);
        }
        releasePending();
      }
      rowSpan.set(freshRow, span);
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

  // Stub cells: each row gets the group and duty labels it is printed beside, or, when they
  // cannot be placed beyond doubt, the rows they could label are kept as unqualified text.
  if (stubs.length > 0) {
    const { prefix, demote, placed, unplaced } = placeStubs(rows, rowSpan, stubs);
    // Demoted rows go to the flat text in page order, with every stub that could not be placed and
    // every placed stub whose rows another stub kind demoted (#5598 Codex F2, rounds 1 and 2).
    // No printed label is lost and none is affirmed.
    const flat: Array<{ y: number; text: string }> = [...unplaced, ...[...placed].filter(([, labelled]) => labelled.some((r) => demote.has(r))).map(([s]) => s)]
      .map((s) => ({ y: s.centre, text: renderItems([s.item]) }));
    for (const r of [...rows]) {
      if (demote.has(r)) {
        flat.push({ y: rowSpan.get(r)!.top, text: [r.label, r.unit, ...(r.merged ? [r.cells[0]?.value] : r.cells.map((c) => c.value))].filter(Boolean).join(" ") });
        rows.splice(rows.indexOf(r), 1);
        continue;
      }
      const p = prefix.get(r);
      if (p && r.label.trim() !== "") r.label = [...p, r.label].join(" / ");
    }
    for (const { text } of flat.sort((a, b) => b.y - a.y)) unqualified.push(text);
    for (const s of placed.keys()) if (s.kind === "group") memberYs.push(s.item.y);
  }

  const finalRows: TableRow[] = [];
  for (const r of rows) {
    if (r.label.trim() === "") unqualified.push(rowRawLine.get(r) ?? r.label);
    else finalRows.push(r);
  }

  const caption = captionFor(lines, headerIdx, cols);
  const top = header.y;
  const bottom = lines[lastColumnCellIdx].y;
  return {
    block: { caption, header: headerLabel, models, modelKeys, rows: finalRows, unqualified, top, bottom, bodySize, rowYs, memberYs },
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
  // Repeated catalog keys do not identify independent columns. Serializing by
  // model name would choose the first matching cell twice and drop the other.
  if (new Set(block.modelKeys).size !== block.modelKeys.length) {
    const rows = [block.models.join(" "), ...block.rows.map((r) => [r.label, ...r.cells.map((c) => c.value), r.unit ?? ""].filter(Boolean).join(" "))];
    return splitRowsIntoChunks(prefix ? `${prefix} — unqualified` : "unqualified", [...rows, ...block.unqualified])
      .map((text) => ({ text, models: [...new Set(block.modelKeys)], unqualified: true }));
  }
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
export function pageWithTables(items: readonly LayoutItem[], sectionBoundaries: readonly number[] = [], qualifiedHeaders: readonly number[] = []): { remainder: string; chunks: TableChunk[]; remainderItems: LayoutItem[] } | null {
  // A second engineering section can occur at ordinary table-row spacing. Cut the
  // physical input before the single table reader assigns any cells to models.
  // Otherwise its label/continuation heuristics can absorb the next section's values.
  if (sectionBoundaries.length > 0) {
    // A cut must not erase a valid first row merely because the remaining
    // prefix is shorter than the original, already-qualified block. Reuse
    // only that exact physical header, never a new header in a later region.
    const headers = detectModelTables(items).filter((block) => block.rows.length >= 2 && block.rows.some((row) => !row.merged)).map((block) => block.top);
    const cuts = [...new Set(sectionBoundaries)].sort((a, b) => b - a);
    const regions = Array.from({ length: cuts.length + 1 }, () => [] as LayoutItem[]);
    for (const item of items) {
      const region = cuts.filter((cut) => item.y <= cut + LINE_GAP_PT).length;
      regions[region].push(item);
    }
    const chunks: TableChunk[] = [];
    const retained = new Set<LayoutItem>();
    for (const region of regions) {
      const table = pageWithTables(region, [], headers);
      if (table) chunks.push(...table.chunks);
      for (const item of table?.remainderItems ?? region) retained.add(item);
    }
    if (chunks.length === 0) return null;
    const remainderItems = items.filter((item) => retained.has(item));
    return { chunks, remainderItems, remainder: buildLines(remainderItems).map((line) => renderItems(line.items)).join("\n") };
  }
  const blocks = detectModelTables(items).filter((b) => (b.rows.length >= 2 || (b.rows.length === 1 && qualifiedHeaders.includes(b.top))) && b.rows.some((r) => !r.merged));
  const lines = buildLines(items);
  const occupied = new Set<number>();
  lines.forEach((l, idx) => {
    if (blocks.some((b) => l.y <= b.top && l.y >= b.bottom)) occupied.add(idx);
  });
  const keyed = detectModelKeyedTables(lines, occupied);
  if (blocks.length === 0 && keyed.length === 0) return null;

  const chunks: TableChunk[] = [];
  for (const block of blocks) chunks.push(...tableChunks(block).map((chunk) => ({ ...chunk, sourceTop: block.top, sourceBottom: block.bottom, sourceBodySize: block.bodySize, sourceRowYs: block.rowYs, sourceMemberYs: block.memberYs, sourceHeaderSize: Math.max(...items.filter((i) => Math.abs(i.y - block.top) <= LINE_GAP_PT).map((i) => i.size)), sourceCaption: block.caption, sourceModels: block.modelKeys })));
  // A model-keyed table is ONE unqualified chunk (split only by the size budget) tagged with every
  // model of its key column, so retrieval withholds it from a record holding a catalog number and
  // reports the page as unresolved — a flat `GS11N-20P2 230 1.8` line never answers for a value
  // again (#5450). No per-model chunk is written: nothing was tied to a column.
  for (const t of keyed) {
    const prefix = t.caption ? `${t.caption} — unqualified` : "unqualified";
    for (const text of splitRowsIntoChunks(prefix, t.lines)) chunks.push({ text, models: [...t.modelKeys], unqualified: true, sourceTop: t.top, sourceBottom: t.bottom, sourceCaption: t.caption, sourceModels: t.modelKeys });
  }

  const spans = [...blocks.map((b) => ({ top: b.top, bottom: b.bottom })), ...keyed.map((t) => ({ top: t.top, bottom: t.bottom }))];
  const kept = lines.filter((l) => !spans.some((s) => l.y <= s.top && l.y >= s.bottom));
  const remainder = kept.map((l) => renderItems(l.items)).join("\n");
  // Expose the exact source membership of the remainder. Section boundaries inside removed
  // blocks still exist, but their absence from the remainder is intentional, not a read failure.
  return { remainder, chunks, remainderItems: kept.flatMap((l) => l.items) };
}
