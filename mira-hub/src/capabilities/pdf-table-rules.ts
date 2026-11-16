/**
 * Drawn vertical table rules of one PDF page (#5503 F14).
 *
 * Text position and wording cannot tell a row-group label ("Output Rating") from a new section
 * heading ("2. DC Output Characteristics"): both are short text at the label margin. The page's
 * own line drawings can. A table's column separators are painted rules; a line of text that the
 * model header's separators cross unbroken is physically inside that table, and a heading that
 * starts another section is not.
 *
 * This module only reports where painted vertical rules are. It assigns no model and proves no
 * membership by itself. Every unreadable, unexpected or oversized input yields `null`, which the
 * caller treats as "no rule evidence" (the conservative outcome: no exemption is granted).
 *
 * pdf.js operator numbers and the `constructPath` argument shape `[paintOp, [data], [minX, minY,
 * maxX, maxY]]` are those of the pdf.js build bundled by unpdf 1.x. Any other shape is rejected.
 */
export type VerticalRule = { x: number; y0: number; y1: number };

const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_CONSTRUCT_PATH = 91;
/** stroke, closeStroke, fill, eoFill, fillStroke, eoFillStroke, closeFillStroke, closeEOFillStroke. */
const PAINTING = new Set([20, 21, 22, 23, 24, 25, 26, 27]);
const STROKING = new Set([20, 21, 24, 25, 26, 27]);

const MAX_OPERATORS = 250_000;
const MAX_SEGMENTS = 5_000;
const MAX_RULE_WIDTH_PT = 2;
const MIN_SEGMENT_PT = 6;
const MIN_RULE_PT = 12;
const MERGE_GAP_PT = 2;
const SAME_X_PT = 1;

type Matrix = [number, number, number, number, number, number];

function isMatrix(value: unknown): value is Matrix {
  return (Array.isArray(value) || ArrayBuffer.isView(value)) && (value as ArrayLike<unknown>).length === 6 &&
    Array.from(value as ArrayLike<unknown>).every((n) => typeof n === "number" && Number.isFinite(n));
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** Painted vertical rules, collinear segments merged; `null` when the page gives no usable evidence. */
export function verticalRules(operatorList: unknown): VerticalRule[] | null {
  const list = operatorList as { fnArray?: ArrayLike<number>; argsArray?: ArrayLike<unknown> } | null;
  if (!list || !list.fnArray || !list.argsArray || list.fnArray.length !== list.argsArray.length) return null;
  if (list.fnArray.length > MAX_OPERATORS) return null;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const segments: VerticalRule[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OP_SAVE) stack.push(ctm);
    else if (fn === OP_RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === OP_TRANSFORM) {
      if (!isMatrix(args)) return null;
      ctm = multiply(ctm, Array.from(args) as Matrix);
    } else if (fn === OP_CONSTRUCT_PATH) {
      if (!Array.isArray(args) || typeof args[0] !== "number") return null;
      if (!PAINTING.has(args[0])) continue; // clip-only or unpainted path: invisible
      const box = args[2] as ArrayLike<number> | null | undefined;
      if (!box || box.length !== 4 || !Array.from(box).every((n) => Number.isFinite(n))) continue;
      if (Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6) continue; // rotated drawing: not a table rule
      const xa = ctm[0] * box[0] + ctm[4];
      const xb = ctm[0] * box[2] + ctm[4];
      const ya = ctm[3] * box[1] + ctm[5];
      const yb = ctm[3] * box[3] + ctm[5];
      const left = Math.min(xa, xb), right = Math.max(xa, xb), bottom = Math.min(ya, yb), top = Math.max(ya, yb);
      const width = right - left, height = top - bottom;
      if (height < MIN_SEGMENT_PT) continue;
      if (width <= MAX_RULE_WIDTH_PT) segments.push({ x: (left + right) / 2, y0: bottom, y1: top });
      else if (STROKING.has(args[0]) && width >= MIN_RULE_PT) {
        // A stroked box contributes its two vertical edges; a filled box is shading, not a rule.
        segments.push({ x: left, y0: bottom, y1: top }, { x: right, y0: bottom, y1: top });
      }
      if (segments.length > MAX_SEGMENTS) return null;
    }
  }
  segments.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const merged: VerticalRule[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.x - segment.x) <= SAME_X_PT && segment.y0 <= last.y1 + MERGE_GAP_PT) {
      last.y1 = Math.max(last.y1, segment.y1);
    } else merged.push({ ...segment });
  }
  return merged.filter((rule) => rule.y1 - rule.y0 >= MIN_RULE_PT);
}

/** Indices of the rules whose painted extent crosses baseline `y`. */
export function rulesCrossing(rules: readonly VerticalRule[], y: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < rules.length; i++) if (rules[i].y0 - 1 <= y && y <= rules[i].y1 + 1) ids.push(i);
  return ids;
}
