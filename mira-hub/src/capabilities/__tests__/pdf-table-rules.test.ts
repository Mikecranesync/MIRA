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
