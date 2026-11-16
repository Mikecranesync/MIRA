import { describe, expect, it } from "vitest";
import { rulesCrossing, verticalRules } from "../pdf-table-rules";

/** pdf.js operator numbers used by the reader under test. */
const SAVE = 10, RESTORE = 11, TRANSFORM = 12, PATH = 91, STROKE = 20, FILL = 22, END_PATH = 28;
const list = (ops: Array<[number, unknown]>) => ({ fnArray: ops.map(([fn]) => fn), argsArray: ops.map(([, args]) => args) });
const path = (paint: number, box: number[]): [number, unknown] => [PATH, [paint, [[]], box]];

describe("#5503 F14: painted vertical rules of a PDF page", () => {
  it("merges per-row segments of one separator and keeps a broken separator as two rules", () => {
    const rules = verticalRules(list([
      path(FILL, [269.75, 700, 270.25, 714]), path(FILL, [269.75, 686, 270.25, 700]), // touching: one rule
      path(FILL, [399.75, 700, 400.25, 714]), path(FILL, [399.75, 640, 400.25, 660]), // 40 pt gap: two rules
    ]));
    expect(rules).toEqual([{ x: 270, y0: 686, y1: 714 }, { x: 400, y0: 640, y1: 660 }, { x: 400, y0: 700, y1: 714 }]);
    expect(rulesCrossing(rules!, 705)).toEqual([0, 2]);
    expect(rulesCrossing(rules!, 670)).toEqual([]);
  });

  it("applies the transform stack and restores it", () => {
    const rules = verticalRules(list([
      [SAVE, null], [TRANSFORM, [1, 0, 0, 1, 100, 500]], path(STROKE, [0, 0, 0, 40]), [RESTORE, null],
      path(STROKE, [0, 0, 0, 40]),
    ]));
    expect(rules).toEqual([{ x: 0, y0: 0, y1: 40 }, { x: 100, y0: 500, y1: 540 }]);
  });

  it("ignores what is not a painted vertical rule", () => {
    expect(verticalRules(list([
      path(END_PATH, [270, 600, 270.5, 700]), // clip only: invisible
      path(FILL, [90, 600, 540, 700]), // shading box, not a rule
      path(FILL, [90, 650, 540, 650.5]), // horizontal rule
      path(FILL, [270, 650, 270.5, 654]), // tick shorter than a text line
      [TRANSFORM, [0, 1, -1, 0, 0, 0]], path(FILL, [270, 600, 270.5, 700]), // rotated drawing
    ]))).toEqual([]);
  });

  it("contributes both vertical edges of a stroked box", () => {
    expect(verticalRules(list([path(STROKE, [90, 600, 540, 700])]))).toEqual([{ x: 90, y0: 600, y1: 700 }, { x: 540, y0: 600, y1: 700 }]);
  });

  it.each([
    ["no operator list", null],
    ["mismatched arrays", { fnArray: [PATH], argsArray: [] }],
    ["an unknown path argument shape", list([[PATH, { op: FILL }]])],
    ["a malformed transform", list([[TRANSFORM, [1, 0, 0]]])],
    ["more operators than the bound", { fnArray: new Array(250_001).fill(SAVE), argsArray: new Array(250_001).fill(null) }],
    ["more segments than the bound", list(Array.from({ length: 5_001 }, (_, i) => path(FILL, [i, 0, i + 0.5, 40])))],
  ])("gives no evidence for %s", (_name, input) => {
    expect(verticalRules(input)).toBeNull();
  });
});
