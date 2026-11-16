import { describe, expect, it } from "vitest";
import { rulesCrossing, verticalRules } from "../pdf-table-rules";

/** pdf.js operator numbers used by the reader under test. */
const SAVE = 10, RESTORE = 11, TRANSFORM = 12, PATH = 91, STROKE = 20, FILL = 22, END_PATH = 28;
/** pdf.js path-data codes: moveTo x y, lineTo x y, curveTo (6 numbers), closePath. */
const M = 0, L = 1, C = 2, Z = 4;
const list = (ops: Array<[number, unknown]>) => ({ fnArray: ops.map(([fn]) => fn), argsArray: ops.map(([, args]) => args) });
const bounds = (data: number[]): number[] => {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < data.length;) {
    const n = data[i] === Z ? 0 : data[i] === C ? 6 : 2;
    for (let k = 1; k <= n; k += 2) { xs.push(data[i + k]); ys.push(data[i + k + 1]); }
    i += n + 1;
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
/** A painted path exactly as pdf.js delivers it: paint op, [typed path data], bounding box. */
const path = (paint: number, data: number[]): [number, unknown] => [PATH, [paint, [new Float32Array(data)], new Float32Array(bounds(data))]];
const line = (x0: number, y0: number, x1: number, y1: number) => [M, x0, y0, L, x1, y1];
const rect = (x0: number, y0: number, x1: number, y1: number) => [M, x0, y0, L, x1, y0, L, x1, y1, L, x0, y1, Z];

describe("#5503 F14/F15: painted vertical rules of a PDF page", () => {
  it("merges per-row segments of one separator and keeps a broken separator as two rules", () => {
    const rules = verticalRules(list([
      path(STROKE, line(270, 700, 270, 714)), path(STROKE, line(270, 686, 270, 700)), // touching: one rule
      path(STROKE, line(400, 700, 400, 714)), path(STROKE, line(400, 640, 400, 660)), // 40 pt gap: two rules
    ]));
    expect(rules).toEqual([{ x: 270, y0: 686, y1: 714 }, { x: 400, y0: 640, y1: 660 }, { x: 400, y0: 700, y1: 714 }]);
    expect(rulesCrossing(rules!, 705)).toEqual([0, 2]);
    expect(rulesCrossing(rules!, 670)).toEqual([]);
  });

  it("applies the transform stack and restores it", () => {
    const rules = verticalRules(list([
      [SAVE, null], [TRANSFORM, [1, 0, 0, 1, 100, 500]], path(STROKE, line(0, 0, 0, 40)), [RESTORE, null],
      path(STROKE, line(0, 0, 0, 40)),
    ]));
    expect(rules).toEqual([{ x: 0, y0: 0, y1: 40 }, { x: 100, y0: 500, y1: 540 }]);
  });

  it("reads a thin filled bar as a rule and a stroked rectangle as its two vertical edges", () => {
    expect(verticalRules(list([path(FILL, rect(269.75, 600, 270.25, 700))]))).toEqual([{ x: 270, y0: 600, y1: 700 }]);
    expect(verticalRules(list([path(STROKE, rect(90, 600, 540, 700))]))).toEqual([{ x: 90, y0: 600, y1: 700 }, { x: 540, y0: 600, y1: 700 }]);
  });

  // Round 12 F15: a path's bounding box is not its geometry. Each of these has the bounding box
  // of a rectangle from x=270 to x=500 and y=600 to y=730 and draws no vertical edge at all.
  it.each([
    ["a diagonal", line(270, 600, 500, 730)],
    ["two horizontal lines in one path", [...line(270, 600, 500, 600), ...line(270, 730, 500, 730)]],
    ["a curve", [M, 270, 600, C, 270, 730, 500, 730, 500, 600]],
    ["a chevron", [M, 270, 600, L, 385, 730, L, 500, 600]],
    ["a rectangle with a curved side in the same path", [...rect(270, 600, 500, 730), M, 300, 610, C, 310, 620, 320, 630, 330, 640]],
  ])("derives no rule from the bounding box of %s", (_name, data) => {
    expect(verticalRules(list([path(STROKE, data)]))).toEqual([]);
  });

  it("ignores what is not a painted vertical rule", () => {
    expect(verticalRules(list([
      path(END_PATH, line(270, 600, 270, 700)), // clip only: invisible
      path(FILL, rect(90, 600, 540, 700)), // shading box, not a rule
      path(FILL, line(270, 600, 270, 700)), // a filled open line paints nothing
      path(STROKE, line(90, 650, 540, 650)), // horizontal rule
      path(STROKE, line(270, 650, 270, 654)), // tick shorter than a text line
      path(STROKE, line(270, 600, 272, 700)), // leaning line
      [TRANSFORM, [0, 1, -1, 0, 0, 0]], path(STROKE, line(270, 600, 270, 700)), // rotated drawing
    ]))).toEqual([]);
  });

  // The reader models only as much paint state as decides whether a rule is visible where it is drawn.
  const RULE = [{ x: 270, y0: 600, y1: 700 }];
  const SET_DASH = 6, SET_GSTATE = 9, CLIP = 29, STROKE_RGB = 58, FILL_RGB = 59, STROKE_PATTERN = 53, FORM_BEGIN = 74, FORM_END = 75;
  it.each([
    ["a dark stroke", [[STROKE_RGB, ["#2c2e35"]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a white stroke", [[STROKE_RGB, ["#ffffff"]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a white filled bar", [[FILL_RGB, ["#ffffff"]], path(FILL, rect(269.75, 600, 270.25, 700))], []],
    ["a stroke in a colour the reader cannot evaluate", [[STROKE_PATTERN, ["P1"]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a white stroke undone by restore", [[SAVE, null], [STROKE_RGB, ["#ffffff"]], [RESTORE, null], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a fully transparent stroke", [[SET_GSTATE, [[["CA", 0]]]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a dashed stroke", [[SET_DASH, [[3, 3], 0]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a solid stroke after the dash is cleared", [[SET_DASH, [[3, 3], 0]], [SET_DASH, [[], 0]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["dashes drawn as separate short segments", Array.from({ length: 12 }, (_, i) => path(STROKE, line(270, 600 + i * 8, 270, 606 + i * 8))), []],
    ["a stroke clipped away", [[CLIP, null], path(END_PATH, rect(300, 590, 500, 710)), path(STROKE, line(270, 600, 270, 700))], []],
    ["a stroke shortened by its clip", [[CLIP, null], path(END_PATH, rect(200, 650, 500, 710)), path(STROKE, line(270, 600, 270, 700))], [{ x: 270, y0: 650, y1: 700 }]],
    ["a clip undone by restore", [[SAVE, null], [CLIP, null], path(END_PATH, rect(300, 590, 500, 710)), [RESTORE, null], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a form that moves its drawing", [[FORM_BEGIN, [[1, 0, 0, 1, -200, 0], [0, 0, 612, 792]]], path(STROKE, line(270, 600, 270, 700)), [FORM_END, []]], [{ x: 70, y0: 600, y1: 700 }]],
    ["a stroke after a form ends", [[FORM_BEGIN, [[1, 0, 0, 1, -200, 0], [0, 0, 612, 792]]], [FORM_END, []], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a form that clips its drawing away", [[FORM_BEGIN, [[1, 0, 0, 1, 0, 0], [300, 0, 612, 792]]], path(STROKE, line(270, 600, 270, 700)), [FORM_END, []]], []],
    ["a polyline that leans a point over its length", [path(STROKE, [M, 270, 600, L, 270.5, 650, L, 271, 700])], []],
  ] as Array<[string, Array<[number, unknown]>, unknown]>)("paint state: %s", (_name, ops, expected) => {
    expect(verticalRules(list(ops))).toEqual(expected);
  });

  /** Half of a 20 pt stroke as the reader bounds it under a quarter turn: never less than the drawn 10 pt. */
  const ROTATED_HALF = (20 * Math.hypot(0, 1, -1, 0)) / 2;
  const LINE_WIDTH = 2, IMAGE = 85, SHADING = 62, ANNOTATION = 80, TEXT = 44, MARKED = 70;
  it.each([
    ["a hairline stroke", [[LINE_WIDTH, [0.5]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a stroke as wide as a shading band", [[LINE_WIDTH, [100]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a hairline scaled up into a band", [[TRANSFORM, [50, 0, 0, 1, 0, 0]], [LINE_WIDTH, [1]], path(STROKE, line(5.4, 600, 5.4, 700))], []],
    ["a wide stroke set by graphics state", [[SET_GSTATE, [[["LW", 100]]]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a filled shape with no area", [path(FILL, [M, 270, 600, L, 270, 700, L, 270, 600])], []],
    ["a rule later covered by an opaque fill", [path(STROKE, line(270, 600, 270, 700)), [FILL_RGB, ["#ffffff"]], path(FILL, rect(200, 590, 400, 710))], []],
    ["a rule partly covered by a later fill", [path(STROKE, line(270, 600, 270, 700)), path(FILL, rect(200, 650, 400, 710))], [{ x: 270, y0: 600, y1: 650 }]],
    ["a rule crossed by a later horizontal grid line", [path(STROKE, line(270, 600, 270, 700)), path(FILL, rect(90, 649.5, 540, 650.5))], RULE],
    ["a rule drawn over an earlier fill", [path(FILL, rect(200, 590, 400, 710)), path(STROKE, line(270, 600, 270, 700))], RULE],
    // Anything painted later that is not itself a thin dark mark hides what its bounds cover.
    ["a rule under a later translucent fill", [path(STROKE, line(270, 600, 270, 700)), [SET_GSTATE, [[["ca", 0.3]]]], path(FILL, rect(200, 590, 400, 710))], []],
    ["a rule painted over by a thick white stroke", [path(STROKE, line(270, 600, 270, 700)), [STROKE_RGB, ["#ffffff"]], [LINE_WIDTH, [8]], path(STROKE, line(270, 590, 270, 710))], []],
    ["a rule painted over by a thin white fill", [path(STROKE, line(270, 600, 270, 700)), [FILL_RGB, ["#ffffff"]], path(FILL, rect(269, 590, 271, 710))], []],
    ["a rule cut by stacked thin white bands", [path(STROKE, line(270, 600, 270, 700)), [FILL_RGB, ["#ffffff"]], ...Array.from({ length: 15 }, (_, i) => path(FILL, rect(200, 660 + i * 2, 400, 662 + i * 2)))], [{ x: 270, y0: 600, y1: 660 }]],
    ["a rule inside a dark thin frame drawn later", [path(STROKE, line(270, 600, 270, 700)), path(STROKE, rect(90, 590, 540, 710))], [{ x: 90, y0: 590, y1: 710 }, { x: 270, y0: 600, y1: 700 }, { x: 540, y0: 590, y1: 710 }]],
    ["a dark bar overpainted by its own white outline", [[FILL_RGB, ["#000000"]], [STROKE_RGB, ["#ffffff"]], [LINE_WIDTH, [2]], path(24, rect(269.5, 600, 270.5, 700))], []],
    ["a rule with a hairline white gap", [path(STROKE, line(270, 600, 270, 700)), [FILL_RGB, ["#ffffff"]], path(FILL, rect(200, 663.75, 400, 664.5))], [{ x: 270, y0: 600, y1: 663.75 }, { x: 270, y0: 664.5, y1: 700 }]],
    ["a rule cut by a zero-width white hairline", [path(STROKE, line(270, 600, 270, 700)), [STROKE_RGB, ["#ffffff"]], [LINE_WIDTH, [0]], path(STROKE, line(200, 664, 400, 664))], [{ x: 270, y0: 600, y1: 664 }, { x: 270, y0: 664, y1: 700 }]],
    ["a yellow line", [[STROKE_RGB, ["#ffff00"]], path(STROKE, line(270, 600, 270, 700))], []],
    ["a rule under a later pale thin band", [path(STROKE, line(270, 600, 270, 700)), [FILL_RGB, ["#dfdfdf"]], path(FILL, rect(200, 650, 400, 652))], [{ x: 270, y0: 600, y1: 650 }, { x: 270, y0: 652, y1: 700 }]],
    ["a rule under the ordinary graphics state", [[SET_GSTATE, [[["BM", "source-over"], ["CA", 1], ["SMask", false], ["ca", 1], ["LC", 0]]]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a mid-grey rule", [[STROKE_RGB, ["#707176"]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["an hourglass fill pinched to nothing", [path(FILL, [M, 270, 600, L, 271, 600, L, 270, 700, L, 271, 700, Z])], []],
    ["a thin filled rectangle bar", [path(FILL, rect(270, 600, 271, 700))], [{ x: 270.5, y0: 600, y1: 700 }]],
    ["a rule inside a form whose box is not upright", [[TRANSFORM, [0.707, 0.707, -0.707, 0.707, 310, 680]], [FORM_BEGIN, [null, [-56, -1, 56, 1]]], [TRANSFORM, [0.707, -0.707, 0.707, 0.707, -700, -261]], path(STROKE, line(270, 600, 270, 730)), [FORM_END, []]], []],
    ["a rule covered under a clip the reader cannot model", [path(STROKE, line(270, 600, 270, 730)), [SAVE, null], [CLIP, null], path(END_PATH, [M, 270, 560, L, 400, 670, L, 270, 780, L, 140, 670, Z]), [FILL_RGB, ["#ffffff"]], path(FILL, rect(200, 650, 340, 690)), [RESTORE, null]], [{ x: 270, y0: 600, y1: 650 }, { x: 270, y0: 690, y1: 730 }]],
    ["a rule covered by an image under such a clip", [path(STROKE, line(270, 600, 270, 730)), [SAVE, null], [CLIP, null], path(END_PATH, [M, 270, 560, L, 400, 670, L, 270, 780, L, 140, 670, Z]), [TRANSFORM, [140, 0, 0, 40, 200, 650]], [IMAGE, ["img", 1, 1]], [RESTORE, null]], [{ x: 270, y0: 600, y1: 650 }, { x: 270, y0: 690, y1: 730 }]],
    ["a rule covered inside a rotated form", [path(STROKE, line(270, 600, 270, 730)), [SAVE, null], [TRANSFORM, [0, 1, -1, 0, 0, 0]], [FORM_BEGIN, [null, [0, -800, 800, 0]]], [TRANSFORM, [0, -1, 1, 0, 0, 0]], [FILL_RGB, ["#ffffff"]], path(FILL, rect(200, 650, 340, 690)), [FORM_END, []], [RESTORE, null]], [{ x: 270, y0: 600, y1: 650 }, { x: 270, y0: 690, y1: 730 }]],
    ["a rule under a thick white stroke drawn in a rotated frame", [path(STROKE, line(270, 600, 270, 730)), [SAVE, null], [TRANSFORM, [0, 1, -1, 0, 0, 0]], [LINE_WIDTH, [20]], [STROKE_RGB, ["#ffffff"]], path(STROKE, line(660, -200, 660, -400)), [RESTORE, null]], [{ x: 270, y0: 600, y1: 660 - ROTATED_HALF }, { x: 270, y0: 660 + ROTATED_HALF, y1: 730 }]],
    ["a rule under a thick dark stroke drawn in a rotated frame", [path(STROKE, line(270, 600, 270, 730)), [SAVE, null], [TRANSFORM, [0, 1, -1, 0, 0, 0]], [LINE_WIDTH, [20]], path(STROKE, line(660, -200, 660, -400)), [RESTORE, null]], [{ x: 270, y0: 600, y1: 660 - ROTATED_HALF }, { x: 270, y0: 660 + ROTATED_HALF, y1: 730 }]],
    ["a line continued after closing its path", [path(STROKE, [M, 300, 600, L, 270, 600, Z, L, 270, 730])], []],
    ["a rule under a triangular clip", [[CLIP, null], path(END_PATH, [M, 260, 740, L, 500, 740, L, 500, 600, Z]), path(STROKE, line(270, 600, 270, 700))], []],
    ["a rule under a clip with a hole", [[30, null], path(END_PATH, [...rect(200, 590, 500, 740), ...rect(250, 640, 300, 700)]), path(STROKE, line(270, 600, 270, 720))], []],
    ["a rule later covered by an image", [path(STROKE, line(270, 600, 270, 700)), [SAVE, null], [TRANSFORM, [200, 0, 0, 200, 200, 550]], [IMAGE, ["img", 10, 10]], [RESTORE, null]], []],
    ["a rule later covered by a shading", [path(STROKE, line(270, 600, 270, 700)), [SHADING, ["p"]]], []],
    ["a rule beside text and marked content", [[MARKED, ["P", null]], [TEXT, [[]]], path(STROKE, line(270, 600, 270, 700))], RULE],
    ["a path closed by its paint operator", [path(21, [M, 270, 600, L, 500, 600, L, 500, 700, L, 270, 700])], [{ x: 270, y0: 600, y1: 700 }, { x: 500, y0: 600, y1: 700 }]],
  ] as Array<[string, Array<[number, unknown]>, unknown]>)("visibility: %s", (_name, ops, expected) => {
    expect(verticalRules(list(ops))).toEqual(expected);
  });

  it.each([
    ["a negative line width", list([[2, [-3]]])],
    ["a text mode that clips", list([[38, [7]], path(STROKE, line(270, 600, 270, 700))])],
    ["a graphics-state key the reader does not know", list([[9, [[["TR", "x"]]]]])],
    ["a soft mask", list([[9, [[["SMask", true]]]], path(STROKE, line(270, 600, 270, 700))])],
    ["a blend mode other than normal", list([[9, [[["BM", "difference"]]]], path(STROKE, line(270, 600, 270, 700))])],
    ["a painted path without usable bounds", list([[PATH, [STROKE, [new Float32Array(line(270, 600, 270, 700))], null]]])],
    ["a page with a drawn annotation", list([path(STROKE, line(270, 600, 270, 700)), [ANNOTATION, ["a1", [0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], false]]])],
    ["an operator the reader does not know", list([path(STROKE, line(270, 600, 270, 700)), [76, [{}]]])],
    ["a line width that is not a number", list([[2, ["x"]]])],
    ["a filled path without usable bounds", list([[PATH, [FILL, [new Float32Array(rect(200, 590, 400, 710))], null]]])],
  ])("gives no evidence for %s", (_name, input) => {
    expect(verticalRules(input)).toBeNull();
  });

  it.each([
    ["a form with a malformed matrix", list([[74, [[1, 0], [0, 0, 1, 1]]]])],
    ["a clip whose path has no usable bounds", list([[29, null], [PATH, [END_PATH, [new Float32Array(rect(0, 0, 10, 10))], null]]])],
  ])("gives no evidence for %s", (_name, input) => {
    expect(verticalRules(input)).toBeNull();
  });

  it.each([
    ["no operator list", null],
    ["mismatched arrays", { fnArray: [PATH], argsArray: [] }],
    ["an unknown path argument shape", list([[PATH, { op: FILL }]])],
    ["path data that is not a number list", list([[PATH, [STROKE, [[]], [0, 0, 1, 1]]], [PATH, [STROKE, ["M 0 0"], [0, 0, 1, 1]]]])],
    ["truncated path data", list([[PATH, [STROKE, [new Float32Array([M, 270, 600, L, 270])], null]]])],
    ["an unknown path code", list([[PATH, [STROKE, [new Float32Array([M, 270, 600, 9, 270, 700])], null]]])],
    ["a malformed transform", list([[TRANSFORM, [1, 0, 0]]])],
    ["more operators than the bound", { fnArray: new Array(250_001).fill(SAVE), argsArray: new Array(250_001).fill(null) }],
    ["more segments than the bound", list(Array.from({ length: 5_001 }, (_, i) => path(STROKE, line(i, 0, i, 40))))],
  ])("gives no evidence for %s", (_name, input) => {
    expect(verticalRules(input)).toBeNull();
  });
});
