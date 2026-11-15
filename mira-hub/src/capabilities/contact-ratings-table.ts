/**
 * contact-ratings-table (#5474 item 5) — which column each figure of a contact-ratings table
 * belongs to, read at upload from where the page prints it.
 *
 * A relay contact-ratings table gives several ampere figures for one voltage: what the contact
 * may MAKE, what it may BREAK, and what it may carry CONTINUOUSLY. The flattened page text keeps
 * the figures ("120 V AC 15 A 1.5 A 2 A") but not their heads, so neither the model nor the
 * #5466 answer check can tell which is which. On staging 2199f449a the answer read that row as
 * "make 1.5 A, break 2 A"; the page says make 15 A, break 1.5 A, continuous 2 A.
 *
 * The positioned text items of the page do keep it: a figure is printed at the x of its head.
 * This module reads that, writes it as plain lines stored with the page text (so the model reads
 * them and `rating-column.ts` can check an answer against them), and reads those lines back.
 *
 * Each stored line stands alone: it carries its own mark, its row and a closing full stop, and is
 * at most 120 characters, the overlap of the upload chunker. So wherever a chunk boundary falls,
 * every line is whole in one chunk, and a line cut short is never read as a row. (The first
 * version put one long head line over the block; a boundary through it left no chunk readable.)
 *
 * Rules (`__tests__/contact-ratings-table.test.ts` types the expected values from the page):
 *  - Lines: items grouped by y (gap <= 2.5 pt), sorted by x.
 *  - Head line: the topmost line with an item that is exactly "Make" and one that is exactly
 *    "Break". A "Continuous" item must sit within 20 pt of it, above or below.
 *  - Rows: the unbroken run of lines directly under the head line whose leftmost item is a
 *    voltage ("120 V AC").
 *  - A cell is an item that is exactly an ampere figure ("15 A"). It belongs to the one head
 *    item whose left edge is within 4 pt of its own. A volt-ampere figure carries no "A" and is
 *    never a cell.
 *  - A head word printed twice (this page also has Make and Break under Volt-Amperes): only the
 *    leftmost places a figure. An ampere figure under another one is in a column this reader
 *    does not know, and its row is not placed.
 *  - A row is placed only when every cell on it found exactly one head, that head places, and
 *    no two cells share one. Otherwise all its figures are "unread".
 *  - Make and break are given only when the row has a cell under each. One figure at the make
 *    position with nothing at the break position is how the page prints a cell that spans both;
 *    positions cannot tell that from a make-only figure, so it is unread.
 *  - A continuous figure is given to the row it is printed on, and to no other: a cell merged
 *    down several rows cannot be bounded from positions (the rule #5450 settled on).
 *  - One voltage on two rows (resistive and inductive blocks, say): the stored lines could not
 *    say which is which, so the page is not read (null).
 *  - No row with a column: the page is not read as a table at all (null).
 *
 * PURE: no I/O, no model call.
 */
import type { LayoutItem } from "./pdf-layout-items";

export type RatingColumn = "make" | "break" | "continuous";
/** One row of the table. A column the page does not place on this row is null; `unread` are the
 *  row's ampere figures that were given no column, as printed. */
export type ColumnRow = { label: string; make: string | null; break: string | null; continuous: string | null; unread: string[] };

/** How every stored line opens. */
export const COLUMN_LINE_MARK = "Contact ratings table (columns read from the page layout), ";
/** A stored line is never longer than the upload chunker's overlap, so no chunk boundary can
 *  leave it whole in neither chunk. A row whose line would be longer is not written. */
export const COLUMN_LINE_MAX = 120;

const LINE_GAP_PT = 2.5;
const HEAD_BAND_PT = 20;
const COLUMN_TOL_PT = 4;
const COLUMNS: readonly RatingColumn[] = ["make", "break", "continuous"];
const VOLTAGE = String.raw`\d+(?:\.\d+)?\s?V(?:\s?(?:AC|DC))?`;
const AMPERES = String.raw`\d+(?:\.\d+)?\s?A`;
const VOLTAGE_CELL_RE = new RegExp(`^${VOLTAGE}$`);
const AMPERE_CELL_RE = new RegExp(`^${AMPERES}$`);
// "<mark><voltage> row: make <A>, break <A>, continuous <A>; no column read for <A>, <A>." — every
// part after the label optional, but one must be there.
const STORED_ROW_RE = new RegExp(
  `^${COLUMN_LINE_MARK.replace(/[()]/g, "\\$&")}(${VOLTAGE}) row: (?:make (${AMPERES}), break (${AMPERES}))?(?:(?:, )?continuous (${AMPERES}))?(?:(?:; )?no column read for (${AMPERES}(?:, ${AMPERES})*))?\\.$`,
);
// A piece of a stored line left at the edge of a chunk. It is not a row of the printed table.
const STORED_PIECE_RE = / row: (?:make \d|continuous \d|no column read for )/;

type Line = { y: number; items: LayoutItem[] };

function linesOf(items: readonly LayoutItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.y - it.y <= LINE_GAP_PT) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

const isWord = (item: LayoutItem, word: RatingColumn) => item.str.trim().toLowerCase() === word;

/** The table's rows with each figure's column, or null when the page holds no such table. */
export function contactRatingColumns(items: readonly LayoutItem[]): ColumnRow[] | null {
  return contactRatingTable(items)?.rows ?? null;
}

/** The same column read, with the last source row so derived text stays inside its table. */
export function contactRatingTable(items: readonly LayoutItem[]): { rows: ColumnRow[]; lastRow: LayoutItem } | null {
  const lines = linesOf(items);
  const headAt = lines.findIndex((l) => l.items.some((i) => isWord(i, "make")) && l.items.some((i) => isWord(i, "break")));
  if (headAt === -1) return null;
  const headY = lines[headAt].y;
  const heads = lines
    .filter((l) => Math.abs(l.y - headY) <= HEAD_BAND_PT)
    .flatMap((l) => l.items.flatMap((i) => COLUMNS.filter((c) => isWord(i, c)).map((column) => ({ column, x: i.x }))))
    .map((h, _k, all) => ({ ...h, places: all.every((o) => o.column !== h.column || o.x >= h.x) }));
  if (!heads.some((h) => h.column === "continuous")) return null;

  const rows: ColumnRow[] = [];
  let lastRow: LayoutItem | undefined;
  for (const line of lines.slice(headAt + 1)) {
    const label = line.items[0].str.trim();
    if (!VOLTAGE_CELL_RE.test(label)) break;
    const cells = line.items.slice(1).filter((i) => AMPERE_CELL_RE.test(i.str.trim()));
    const placed = cells.map((cell) => heads.filter((h) => Math.abs(h.x - cell.x) <= COLUMN_TOL_PT));
    const under = (column: RatingColumn) => cells.filter((_c, k) => placed[k][0].column === column).map((c) => c.str.trim());
    const sound = placed.every((p) => p.length === 1 && p[0].places) && COLUMNS.every((c) => under(c).length <= 1);
    const row: ColumnRow = { label, make: null, break: null, continuous: null, unread: [] };
    if (sound) {
      const [make] = under("make");
      const [brk] = under("break");
      const [continuous] = under("continuous");
      if (make && brk) [row.make, row.break] = [make, brk];
      else row.unread.push(...[make, brk].filter((f): f is string => Boolean(f)));
      if (continuous) row.continuous = continuous;
    } else row.unread.push(...cells.map((c) => c.str.trim()));
    rows.push(row);
    lastRow = line.items[0];
  }
  if (new Set(rows.map((r) => r.label)).size !== rows.length) return null;
  return lastRow && rows.some((r) => r.make || r.continuous) ? { rows, lastRow } : null;
}

/** The lines stored with the page text: one per row that has a figure. "No column read for" a
 *  figure means the row prints it but its column could not be read from positions. */
export function columnLines(rows: readonly ColumnRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const placed = [r.make && r.break ? `make ${r.make}, break ${r.break}` : "", r.continuous ? `continuous ${r.continuous}` : ""].filter(Boolean).join(", ");
    const unread = r.unread.length > 0 ? `no column read for ${r.unread.join(", ")}` : "";
    if (!placed && !unread) continue;
    const line = `${COLUMN_LINE_MARK}${r.label} row: ${[placed, unread].filter(Boolean).join("; ")}.`;
    if (line.length <= COLUMN_LINE_MAX) out.push(line);
  }
  return out;
}

/** `text` with the column lines placed directly under the table's last row (the last line that
 *  opens with one of the rows' voltages, after the line that names Make and Break). When the text
 *  does not hold the rows they go at the end. No blank line is added: the chunker breaks on one. */
export function withColumnLines(text: string, rows: readonly ColumnRow[]): string {
  const block = columnLines(rows);
  if (block.length === 0) return text;
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /\bmake\b/i.test(l) && /\bbreak\b/i.test(l));
  let last = -1;
  if (head !== -1) lines.forEach((l, k) => { if (k > head && rows.some((r) => l.trim().startsWith(`${r.label} `) || l.trim() === r.label)) last = k; });
  if (last === -1) return [...lines, ...block].join("\n");
  return [...lines.slice(0, last + 1), ...block, ...lines.slice(last + 1)].join("\n");
}

/** The column rows stored in `content`, and the content without the stored lines. Every whole
 *  stored line is a row, wherever it stands. A piece of one (a chunk edge) is no row, and is left
 *  out of `rest` too. */
export function readColumnLines(content: string): { rows: ColumnRow[]; rest: string } {
  if (!content.includes(" row: ")) return { rows: [], rest: content };
  const rows: ColumnRow[] = [];
  const rest: string[] = [];
  for (const line of content.split("\n")) {
    const m = STORED_ROW_RE.exec(line.trim());
    if (m && (m[2] || m[4] || m[5])) rows.push({ label: m[1], make: m[2] ?? null, break: m[3] ?? null, continuous: m[4] ?? null, unread: m[5] ? m[5].split(", ") : [] });
    else if (!STORED_PIECE_RE.test(line)) rest.push(line);
  }
  return { rows, rest: rest.join("\n") };
}
