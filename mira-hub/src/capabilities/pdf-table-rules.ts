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
 * Rules come from the path's own segments, never from its bounding box (#5503 F15): a diagonal,
 * a curve or two horizontal lines share a rectangle's box and draw no vertical edge.
 *
 * pdf.js operator numbers, the `constructPath` argument shape `[paintOp, [data], bounds]` and the
 * path-data codes (0 moveTo x y, 1 lineTo x y, 2 and 3 curves, 4 closePath) are those of the
 * pdf.js build bundled by unpdf 1.x. Any other shape is rejected.
 */
export type VerticalRule = { x: number; y0: number; y1: number };

const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_CONSTRUCT_PATH = 91;
/** stroke, closeStroke, fill, eoFill, fillStroke, eoFillStroke, closeFillStroke, closeEOFillStroke. */
const PAINTING = new Set([20, 21, 22, 23, 24, 25, 26, 27]);
const STROKING = new Set([20, 21, 24, 25, 26, 27]);
const FILLING = new Set([22, 23, 24, 25, 26, 27]);
const PATH_MOVE = 0, PATH_LINE = 1, PATH_CURVE = 2, PATH_QUADRATIC = 3, PATH_CLOSE = 4;
/** A stroked edge is vertical when it leans less than this over its whole length. */
const MAX_LEAN_PT = 0.5;

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

type Subpath = { points: Array<[number, number]>; closed: boolean };

/** The straight-line subpaths of one path. A path holding any curve yields none: it is a drawing,
 * not a rule. `null` when the data is not the expected number list (the page then gives no evidence). */
function straightSubpaths(pathArgument: unknown): Subpath[] | null {
  if (!Array.isArray(pathArgument) || pathArgument.length !== 1) return null;
  const raw = pathArgument[0];
  if (!(Array.isArray(raw) || ArrayBuffer.isView(raw))) return null;
  const data = Array.from(raw as ArrayLike<unknown>);
  if (data.length === 0 || !data.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const numbers = data as number[];
  const subpaths: Subpath[] = [];
  for (let i = 0; i < numbers.length;) {
    const code = numbers[i];
    if (code === PATH_CURVE || code === PATH_QUADRATIC) return [];
    if (code === PATH_CLOSE) {
      if (subpaths.length === 0) return null;
      subpaths[subpaths.length - 1].closed = true;
      i += 1;
    } else if (code === PATH_MOVE || code === PATH_LINE) {
      if (i + 2 >= numbers.length) return null;
      if (code === PATH_MOVE) subpaths.push({ points: [], closed: false });
      if (subpaths.length === 0) return null;
      subpaths[subpaths.length - 1].points.push([numbers[i + 1], numbers[i + 2]]);
      i += 3;
    } else return null;
  }
  return subpaths;
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
      const subpaths = straightSubpaths(args[1]);
      if (subpaths === null) return null;
      if (Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6) continue; // rotated drawing: not a table rule
      for (const subpath of subpaths) {
        const points = subpath.points.map(([x, y]) => [ctm[0] * x + ctm[4], ctm[3] * y + ctm[5]]);
        if (STROKING.has(args[0])) {
          // Each straight vertical edge the pen actually draws, the closing edge included.
          const drawn = subpath.closed && points.length > 2 ? [...points, points[0]] : points;
          for (let k = 1; k < drawn.length; k++) {
            const [xa, ya] = drawn[k - 1], [xb, yb] = drawn[k];
            if (Math.abs(xa - xb) <= MAX_LEAN_PT && Math.abs(ya - yb) >= MIN_SEGMENT_PT) {
              segments.push({ x: (xa + xb) / 2, y0: Math.min(ya, yb), y1: Math.max(ya, yb) });
            }
          }
        }
        if (FILLING.has(args[0]) && points.length >= 3) {
          // A filled shape is a rule only when the whole shape is a thin vertical bar.
          const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
          const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
          if (right - left <= MAX_RULE_WIDTH_PT && top - bottom >= MIN_SEGMENT_PT) {
            segments.push({ x: (left + right) / 2, y0: bottom, y1: top });
          }
        }
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
