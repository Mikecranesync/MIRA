/**
 * Work Packet (#4982) — figure-caption lines from PDF layout (Codex #5062 F15).
 *
 * In CAT Pumps service manuals each photo is an image drawn on the page, and its caption is printed
 * directly beneath it, inside the photo's column. Measured on the real 35-frame and 3CP/5CP/7CP
 * manuals (pages 2–5, every caption): the caption is one or two rows whose baselines sit 10–12pt and
 * 21–23pt below the image's bottom edge, starting at the image's left edge and never wider than the
 * image, in a type size other than the page's body size (9.5/8.5 against body 10, 8.5 against body
 * 8). A CAUTION block is as wide as the text column, so it never fits under a photo.
 *
 * So a caption is recognised only where it is positively established: an actual image, and text
 * inside the band directly under it. Spacing or a smaller font alone never make text a caption
 * (rounds 9–10: a smaller-font safety continuation under a caption, or a smaller-font CAUTION below
 * a large gap, was dropped). The words are never consulted.
 *
 * Even a positively established caption band can hold the rest of an instruction (round 11: a
 * one-line caption, then a small-print safety line inside the band). So the parser uses these lines
 * only to keep caption text out of step and caution text; it never skips one after a step or caution
 * — that block becomes a gap instead (`catpumps-service-manual.ts`).
 *
 * Pure: takes the page's text items and image boxes (pdf.js `getTextContent` / `getOperatorList`)
 * and the extracted page text, returns the extracted lines that consist only of caption-band items.
 * Every condition fails toward "not a figure line" — the parser then treats the line as content.
 */

export interface LayoutItem {
  str: string;
  /** Left edge in PDF user space. */
  x: number;
  /** Baseline y in PDF user space (0 = bottom of the page). */
  y: number;
  /** Advance width (pt). */
  w: number;
  /** Font size (pt). */
  size: number;
}

/** An image drawn on the page, in PDF user space. */
export interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** pdf.js object name of an XObject image (to fetch its pixels); absent for inline images. */
  name?: string;
}

/** Caption rows sit at most this far (pt) below the image's bottom edge — two rows (real: 21–23pt). */
const CAPTION_BAND_PT = 26;
/** Caption text may start/end at most this far (pt) outside the image's left/right edge (real: ≤1pt). */
const COLUMN_SLACK_PT = 3;
/** Items whose baselines differ by less than this are on the same printed row (pt). */
const ROW_TOLERANCE_PT = 2;
/** Images smaller than this (pt) on either side are rules, bullets or logos, not photos. */
const MIN_PHOTO_PT = 40;

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

function underPhoto(it: LayoutItem, img: ImageBox): boolean {
  return (
    it.y < img.y0 &&
    it.y >= img.y0 - CAPTION_BAND_PT &&
    it.x >= img.x0 - COLUMN_SLACK_PT &&
    it.x + it.w <= img.x1 + COLUMN_SLACK_PT
  );
}

/** The page's photos, each with the caption rows printed under it (non-body-size text inside its
 *  caption band, top to bottom). Used to show the manufacturer's photo beside the steps. */
export function figuresForPage(items: LayoutItem[], images: ImageBox[]): { box: ImageBox; caption: string[] }[] {
  const photos = images.filter((b) => b.x1 - b.x0 >= MIN_PHOTO_PT && b.y1 - b.y0 >= MIN_PHOTO_PT);
  const text = items.filter((it) => norm(it.str).length > 0);
  const body = bodySize(text);
  return photos.map((box) => {
    const under = text.filter((it) => it.size !== body && underPhoto(it, box)).sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: LayoutItem[][] = [];
    for (const it of under) {
      const row = rows[rows.length - 1];
      if (row && row[0].y - it.y < ROW_TOLERANCE_PT) row.push(it);
      else rows.push([it]);
    }
    return { box, caption: rows.map((r) => norm(r.map((it) => it.str).join(" "))) };
  });
}

export function figureLinesForPage(items: LayoutItem[], images: ImageBox[], pageText: string): string[] {
  const photos = images.filter((b) => b.x1 - b.x0 >= MIN_PHOTO_PT && b.y1 - b.y0 >= MIN_PHOTO_PT);
  const text = items.filter((it) => norm(it.str).length > 0);
  const body = bodySize(text);
  if (body === null || photos.length === 0) return [];
  // Printed rows; a row counts only if every item on it is non-body text inside a photo's caption band.
  const rows: LayoutItem[][] = [];
  for (const it of [...text].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1];
    if (row && row[0].y - it.y < ROW_TOLERANCE_PT) row.push(it);
    else rows.push([it]);
  }
  const pieces = new Set<string>();
  for (const row of rows) {
    const caption = row.every((it) => it.size !== body && photos.some((img) => underPhoto(it, img)));
    if (caption) for (const it of row) pieces.add(norm(it.str));
  }
  if (pieces.size === 0) return [];
  return pageText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && composedOf(norm(l), pieces));
}

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** pdf.js operator codes this reader needs (`OPS` from pdfjs). */
export interface ImageOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageXObjectRepeat: number;
}

/** Bounding boxes of the images a page's operator list paints (an image fills its CTM's unit square). */
export function imageBoxesFromOps(fnArray: number[], argsArray: unknown[], ops: ImageOps): ImageBox[] {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const boxes: ImageBox[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = mul(ctm, args as number[]);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0];
      if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m as number[]);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageXObjectRepeat) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      const name = fn !== ops.paintInlineImageXObject && typeof args?.[0] === "string" ? (args[0] as string) : undefined;
      boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), ...(name ? { name } : {}) });
    }
  }
  return boxes;
}
