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
 * Colour, opacity, line width, dash, clip and embedded-form state are tracked just far enough to
 * drop a rule that is not visibly drawn where its coordinates say. The reader is not a renderer and
 * errs one way only: everything painted after a rule hides what its bounds cover unless it is
 * itself a thin dark mark; a clip that is not one upright rectangle shows nothing; a colour it
 * cannot evaluate counts as not drawn; and a soft mask, a non-normal blend mode or any operator it
 * does not model (annotations, transparency groups, repeated or inline images) leaves the whole
 * page without evidence.
 * Not modelled: text glyphs drawn over a rule.
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
const OP_SET_LINE_WIDTH = 2;
const OP_SET_DASH = 6;
const OP_SET_GSTATE = 9;
const OP_CLIP = 29;
const OP_EO_CLIP = 30;
const OP_STROKE_RGB = 58;
const OP_FILL_RGB = 59;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;
const OP_SHADING_FILL = 62;
/** Images that paint the unit square of the current matrix. */
const UNIT_SQUARE_IMAGE = new Set([83, 85, 90]);
/** Operators that neither paint over a rule nor change how one is painted: resource loading,
 * stroke joins and caps, rendering hints, text and marked content. Everything not named in this
 * file is unknown and leaves the page without evidence. */
const NEUTRAL = new Set([1, 3, 4, 5, 7, 8, 31, 32, 33, 34, 35, 36, 37, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 69, 70, 71, 72, 73]);
const OP_TEXT_RENDERING_MODE = 38;
/** Graphics-state keys that cannot hide or move a rule. */
const NEUTRAL_GSTATE = new Set(["LC", "LJ", "ML", "RI", "FL", "Font"]);
const CLOSING_PAINT = new Set([21, 26, 27]);
/** A filled shape thinner than this in area paints nothing. */
const MIN_FILL_AREA = 0.05;
/** Every other operator that sets a stroke / fill colour; the reader cannot evaluate those. */
const OTHER_STROKE_COLOUR = new Set([50, 52, 53, 56, 60, 92]);
const OTHER_FILL_COLOUR = new Set([51, 54, 55, 57, 61, 93]);
/** Paint operators of a path: stroke 20, closeStroke 21, fill 22, eoFill 23, and the four fill-and-stroke forms 24-27. */
const STROKING = new Set([20, 21, 24, 25, 26, 27]);
const FILLING = new Set([22, 23, 24, 25, 26, 27]);
const PATH_MOVE = 0, PATH_LINE = 1, PATH_CURVE = 2, PATH_QUADRATIC = 3, PATH_CLOSE = 4;
/** A stroked edge is vertical when it leans less than this over its whole length. */
const MAX_LEAN_PT = 0.25;

const MAX_OPERATORS = 250_000;
const MAX_SEGMENTS = 5_000;
const MAX_RULE_WIDTH_PT = 2;
const MIN_SEGMENT_PT = 6;
const MIN_RULE_PT = 12;
/** Per-row pieces of one separator touch; explicit dashes leave real gaps and stay separate. */
const MERGE_GAP_PT = 0.75;
const SAME_X_PT = 0.25;

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

type Box = { x0: number; y0: number; x1: number; y1: number };
/** Only the paint state that decides whether a rule is visible where it is drawn. */
type State = { ctm: Matrix; lineWidth: number; stroke: boolean; fill: boolean; strokeAlpha: boolean; fillAlpha: boolean; dashed: boolean; clip: Box | null };

/** A colour pdf.js delivers as "#rrggbb" that is dark enough to read as a ruled line. Anything
 * else (pale, bright, or not in that form) is not evidence. */
function isVisibleColour(args: unknown): boolean {
  const value = Array.isArray(args) ? args[0] : null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return false;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 160;
}

/** The four corners when `points` trace one upright rectangle, else null. */
function uprightRectangle(points: ReadonlyArray<readonly number[]>): ReadonlyArray<readonly number[]> | null {
  const corners = points.length === 5 && points[0][0] === points[4][0] && points[0][1] === points[4][1] ? points.slice(0, 4) : points;
  if (corners.length !== 4) return null;
  return corners.every(([x, y], k) => {
    const [nx, ny] = corners[(k + 1) % 4];
    return (x === nx) !== (y === ny);
  }) ? corners : null;
}

function boxUnder(ctm: Matrix, bounds: unknown): Box | null {
  if (!(Array.isArray(bounds) || ArrayBuffer.isView(bounds))) return null;
  const b = Array.from(bounds as ArrayLike<unknown>);
  if (b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [xa, ya, xb, yb] = b as number[];
  const corners = [[xa, ya], [xa, yb], [xb, ya], [xb, yb]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
  const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function intersect(a: Box | null, b: Box): Box {
  return a === null ? b : { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

/** Painted vertical rules, collinear segments merged; `null` when the page gives no usable evidence. */
export function verticalRules(operatorList: unknown): VerticalRule[] | null {
  const list = operatorList as { fnArray?: ArrayLike<number>; argsArray?: ArrayLike<unknown> } | null;
  if (!list || !list.fnArray || !list.argsArray || list.fnArray.length !== list.argsArray.length) return null;
  if (list.fnArray.length > MAX_OPERATORS) return null;
  // PDF defaults: black, opaque, solid, unclipped.
  let state: State = { ctm: [1, 0, 0, 1, 0, 0], lineWidth: 1, stroke: true, fill: true, strokeAlpha: true, fillAlpha: true, dashed: false, clip: null };
  const stack: State[] = [];
  let clipPending = false;
  /** `cutLow` / `cutHigh`: that end was painted over, so the piece is never joined to a neighbour there. */
  const segments: Array<VerticalRule & { cutLow?: boolean; cutHigh?: boolean }> = [];
  /** Keep the part of a segment its clip leaves visible. */
  const add = (x: number, y0: number, y1: number) => {
    const clip = state.clip;
    if (clip && (x < clip.x0 - MAX_LEAN_PT || x > clip.x1 + MAX_LEAN_PT)) return;
    const bottom = clip ? Math.max(y0, clip.y0) : y0, top = clip ? Math.min(y1, clip.y1) : y1;
    if (top - bottom >= MIN_SEGMENT_PT) segments.push({ x, y0: bottom, y1: top });
  };
  /** Whatever is painted opaquely over an earlier rule hides the part it covers. */
  const cover = (box: Box) => {
    const clip = state.clip;
    const hidden = clip ? intersect(clip, box) : box;
    if (hidden.x1 < hidden.x0 || hidden.y1 < hidden.y0) return;
    for (const segment of segments.splice(0)) {
      if (segment.x < hidden.x0 || segment.x > hidden.x1) { segments.push(segment); continue; }
      if (hidden.y1 < segment.y0 || hidden.y0 > segment.y1) { segments.push(segment); continue; }
      if (hidden.y0 - segment.y0 >= MIN_SEGMENT_PT) segments.push({ x: segment.x, y0: segment.y0, y1: hidden.y0, cutLow: segment.cutLow, cutHigh: true });
      if (segment.y1 - hidden.y1 >= MIN_SEGMENT_PT) segments.push({ x: segment.x, y0: hidden.y1, y1: segment.y1, cutLow: true, cutHigh: segment.cutHigh });
    }
  };
  const NOWHERE: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const EVERYWHERE: Box = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (NEUTRAL.has(fn)) continue;
    if (fn === OP_SAVE) stack.push(state);
    else if (fn === OP_RESTORE) state = stack.pop() ?? state;
    else if (fn === OP_TRANSFORM) {
      if (!isMatrix(args)) return null;
      state = { ...state, ctm: multiply(state.ctm, Array.from(args) as Matrix) };
    } else if (fn === OP_FORM_BEGIN) {
      // An embedded drawing: its own matrix and clipping box, undone at its end.
      stack.push(state);
      if (!Array.isArray(args)) return null;
      if (args[0] != null) {
        if (!isMatrix(args[0])) return null;
        state = { ...state, ctm: multiply(state.ctm, Array.from(args[0]) as Matrix) };
      }
      if (args[1] != null) {
        const box = boxUnder(state.ctm, args[1]);
        if (box === null) return null;
        const upright = Math.abs(state.ctm[1]) <= 1e-6 && Math.abs(state.ctm[2]) <= 1e-6;
        state = { ...state, clip: intersect(state.clip, upright ? box : NOWHERE) };
      }
    } else if (fn === OP_FORM_END) state = stack.pop() ?? state;
    else if (fn === OP_SET_LINE_WIDTH) {
      const width = Array.isArray(args) ? args[0] : null;
      if (typeof width !== "number" || !Number.isFinite(width) || width < 0) return null;
      state = { ...state, lineWidth: width };
    } else if (fn === OP_TEXT_RENDERING_MODE) {
      // Modes 4 to 7 turn text into a clip, which this reader does not model.
      const mode = Array.isArray(args) ? args[0] : null;
      if (typeof mode !== "number" || mode < 0 || mode > 3) return null;
    } else if (fn === OP_SHADING_FILL) cover(EVERYWHERE);
    else if (UNIT_SQUARE_IMAGE.has(fn)) cover(boxUnder(state.ctm, [0, 0, 1, 1])!);
    else if (fn === OP_STROKE_RGB) state = { ...state, stroke: isVisibleColour(args) };
    else if (fn === OP_FILL_RGB) state = { ...state, fill: isVisibleColour(args) };
    else if (OTHER_STROKE_COLOUR.has(fn)) state = { ...state, stroke: false };
    else if (OTHER_FILL_COLOUR.has(fn)) state = { ...state, fill: false };
    else if (fn === OP_SET_DASH) {
      const pattern = Array.isArray(args) ? args[0] : null;
      state = { ...state, dashed: !(Array.isArray(pattern) || ArrayBuffer.isView(pattern)) || (pattern as ArrayLike<unknown>).length > 0 };
    } else if (fn === OP_SET_GSTATE) {
      const entries = Array.isArray(args) && Array.isArray(args[0]) ? args[0] : null;
      if (entries === null) return null;
      for (const entry of entries) {
        if (!Array.isArray(entry)) return null;
        if (entry[0] === "CA") state = { ...state, strokeAlpha: typeof entry[1] === "number" && entry[1] >= 0.5 };
        else if (entry[0] === "ca") state = { ...state, fillAlpha: typeof entry[1] === "number" && entry[1] >= 0.5 };
        else if (entry[0] === "SMask") {
          if (entry[1] !== false) return null; // what a mask shows or hides is not in the operators
        } else if (entry[0] === "BM") {
          if (entry[1] !== "source-over" && entry[1] !== "normal") return null;
        }
        else if (entry[0] === "D") state = { ...state, dashed: true };
        else if (entry[0] === "LW") {
          if (typeof entry[1] !== "number" || !Number.isFinite(entry[1]) || entry[1] < 0) return null;
          state = { ...state, lineWidth: entry[1] };
        } else if (!NEUTRAL_GSTATE.has(entry[0] as string)) return null;
      }
    } else if (fn === OP_CLIP || fn === OP_EO_CLIP) clipPending = true;
    else if (fn === OP_CONSTRUCT_PATH) {
      if (!Array.isArray(args) || typeof args[0] !== "number") return null;
      const ctm = state.ctm;
      const rotated = Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6;
      const subpaths = straightSubpaths(args[1]);
      if (subpaths === null) return null;
      if (CLOSING_PAINT.has(args[0]) && subpaths.length > 0) subpaths[subpaths.length - 1].closed = true;
      const scale = Math.max(Math.abs(ctm[0]), Math.abs(ctm[3]));
      const thinStroke = state.lineWidth * scale <= MAX_RULE_WIDTH_PT;
      const darkStroke = state.stroke && state.strokeAlpha && thinStroke;
      const strokes = STROKING.has(args[0]) && darkStroke && !state.dashed;
      const fills = FILLING.has(args[0]) && state.fill && state.fillAlpha;
      const painted = FILLING.has(args[0]) || STROKING.has(args[0]) ? boxUnder(ctm, args[2]) : EVERYWHERE;
      if (painted === null) return null;
      const placed = rotated ? [] : subpaths.map((subpath) => ({ closed: subpath.closed,
        points: subpath.points.map(([x, y]) => [ctm[0] * x + ctm[4], ctm[3] * y + ctm[5]]) }));
      // Whatever a path paints lies over everything drawn before it, the fill first and then the
      // stroke. Only a thin dark mark (a grid line, a frame, another rule) is known not to hide a
      // rule; anything else, in any colour or opacity, hides what its bounds cover.
      if (FILLING.has(args[0])) {
        const thinFill = Math.min(painted.x1 - painted.x0, painted.y1 - painted.y0) <= MAX_RULE_WIDTH_PT;
        if (!(fills && thinFill)) cover(painted);
        if (fills) for (const { points } of placed) {
          // A filled shape is a rule only when it is one thin upright bar.
          const corners = uprightRectangle(points);
          if (corners === null) continue;
          const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y);
          const left = Math.min(...xs), right = Math.max(...xs), bottom = Math.min(...ys), top = Math.max(...ys);
          if (right - left <= MAX_RULE_WIDTH_PT && (right - left) * (top - bottom) >= MIN_FILL_AREA) add((left + right) / 2, bottom, top);
        }
      }
      if (STROKING.has(args[0])) {
        if (!darkStroke) {
          const half = (state.lineWidth * scale) / 2;
          cover({ x0: painted.x0 - half, y0: painted.y0 - half, x1: painted.x1 + half, y1: painted.y1 + half });
        }
        if (strokes) for (const { points, closed } of placed) {
          // Each straight vertical edge the pen actually draws, the closing edge included.
          const drawn = closed && points.length > 2 ? [...points, points[0]] : points;
          for (let k = 1; k < drawn.length; k++) {
            const [xa, ya] = drawn[k - 1], [xb, yb] = drawn[k];
            if (Math.abs(xa - xb) <= MAX_LEAN_PT && Math.abs(ya - yb) >= MIN_SEGMENT_PT) add((xa + xb) / 2, Math.min(ya, yb), Math.max(ya, yb));
          }
        }
      }
      if (clipPending) {
        // The path just built also becomes the clip. Only a single upright rectangle is modelled;
        // under any other clip nothing is known to be visible.
        clipPending = false;
        const upright = !rotated && subpaths.length === 1 && uprightRectangle(subpaths[0].points) !== null;
        const box = upright ? boxUnder(ctm, args[2]) : NOWHERE;
        if (box === null) return null;
        state = { ...state, clip: intersect(state.clip, box) };
      }
      if (segments.length > MAX_SEGMENTS) return null;
    } else return null; // an operator this reader does not model: the page gives no evidence
  }
  segments.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const merged: Array<VerticalRule & { cutHigh?: boolean }> = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    const joins = last !== undefined && Math.abs(last.x - segment.x) <= SAME_X_PT && segment.y0 <= last.y1 + MERGE_GAP_PT;
    // A piece ending where it was painted over joins only a piece that genuinely overlaps it.
    const acrossCut = last !== undefined && (last.cutHigh === true || segment.cutLow === true) && segment.y0 >= last.y1;
    if (last && joins && !acrossCut) {
      if (segment.y1 > last.y1) { last.y1 = segment.y1; last.cutHigh = segment.cutHigh; }
    } else merged.push({ x: segment.x, y0: segment.y0, y1: segment.y1, cutHigh: segment.cutHigh });
  }
  return merged.filter((rule) => rule.y1 - rule.y0 >= MIN_RULE_PT).map(({ x, y0, y1 }) => ({ x, y0, y1 }));
}

/** A rule runs through a text line only when it passes below the baseline and up through the
 * body of the letters; one that merely reaches the baseline stops at the line. */
const BELOW_BASELINE_PT = 1;
const ABOVE_BASELINE_PT = 4;

/** Indices of the rules whose painted extent runs through the text line at baseline `y`. */
export function rulesCrossing(rules: readonly VerticalRule[], y: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < rules.length; i++) if (rules[i].y0 <= y - BELOW_BASELINE_PT && y + ABOVE_BASELINE_PT <= rules[i].y1) ids.push(i);
  return ids;
}
