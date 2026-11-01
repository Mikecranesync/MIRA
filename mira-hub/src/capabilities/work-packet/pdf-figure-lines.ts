/**
 * Work Packet (#4982) — figure-caption lines from PDF layout (Codex #5062 F15).
 *
 * In CAT Pumps service manuals each photo has its caption printed directly beneath it, in a type
 * size different from the procedure text. Measured on the real 35-frame and 3CP/5CP/7CP manuals
 * (pages 2–5): every caption block starts with a line that has 190–250pt of text-free space above
 * it (the photo), in size 8.5/9.5 against body 8/10, and its second line sits ~10pt below; a
 * CAUTION block, the nearest look-alike, has only 26–34pt above it. The words alone cannot tell a
 * caption from a Title Case sentence; the photo gap and the type size can.
 *
 * Pure: takes the page's text items (pdf.js `getTextContent`) and the extracted page text, returns
 * the extracted lines that consist only of figure-band items. Every condition fails toward "not a
 * figure line" — the parser then treats the line as content, never skips it.
 */

export interface LayoutItem {
  str: string;
  /** Baseline y in PDF user space (0 = bottom of the page). */
  y: number;
  /** Font size (pt). */
  size: number;
}

/** A caption block starts below at least this much text-free space (pt) — the photo above it. */
const PHOTO_GAP_PT = 100;
/** …and continues onto following lines at most this far below the previous one (pt). */
const CAPTION_LEADING_PT = 15;
/** Items whose baselines differ by less than this are on the same printed row (pt). */
const ROW_TOLERANCE_PT = 2;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The page's procedure type size: the size carrying the most characters. */
function bodySize(items: LayoutItem[]): number | null {
  const chars = new Map<number, number>();
  for (const it of items) chars.set(it.size, (chars.get(it.size) ?? 0) + it.str.length);
  let best: number | null = null;
  for (const [size, n] of chars) if (best === null || n > (chars.get(best) ?? 0)) best = size;
  return best;
}

/** True when `line` is exactly a run of `pieces` separated by single spaces (or nothing). */
function composedOf(line: string, pieces: Set<string>): boolean {
  const ok: boolean[] = new Array(line.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < line.length; i++) {
    if (!ok[i]) continue;
    const start = line[i] === " " && i > 0 ? i + 1 : i;
    for (const p of pieces) {
      if (line.startsWith(p, start)) ok[start + p.length] = true;
    }
  }
  return ok[line.length];
}

export function figureLinesForPage(items: LayoutItem[], pageHeight: number, pageText: string): string[] {
  const text = items.filter((it) => norm(it.str).length > 0);
  const body = bodySize(text);
  if (body === null || !(pageHeight > 0)) return [];
  // Printed rows, top of the page first.
  const rows: { y: number; items: LayoutItem[] }[] = [];
  for (const it of [...text].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1];
    if (row && row.y - it.y < ROW_TOLERANCE_PT) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  const pieces = new Set<string>();
  let inBlock = false;
  for (let k = 0; k < rows.length; k++) {
    const above = k === 0 ? pageHeight - rows[k].y : rows[k - 1].y - rows[k].y;
    const notBody = rows[k].items.every((it) => it.size !== body);
    inBlock = notBody && (above >= PHOTO_GAP_PT || (inBlock && above <= CAPTION_LEADING_PT));
    if (inBlock) for (const it of rows[k].items) pieces.add(norm(it.str));
  }
  if (pieces.size === 0) return [];
  return pageText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && composedOf(norm(l), pieces));
}
