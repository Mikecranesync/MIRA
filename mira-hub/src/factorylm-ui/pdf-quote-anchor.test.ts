import { describe, expect, it } from "vitest";
import { anchorQuote, type PdfTextRun } from "./pdf-quote-anchor";
const viewport = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800-y] };
const run = (str: string, y = 700): PdfTextRun => ({ str, transform: [12,0,0,12,40,y], width: 240, height: 12, fontName: "font" });
describe("uploaded PDF quote anchors", () => {
  it("matches whitespace across PDF text runs, preserving page geometry", () => {
    const result = anchorQuote("Inspect the drive before starting.", [run("Inspect the drive"), run(" "), run(""), run("before starting.", 680)], viewport);
    expect(result.rects).toHaveLength(2);
    expect(result.rects[0].left).toBeCloseTo(40/600*100);
    expect(result.rects[0].top).toBeLessThan(result.rects[1].top);
  });
  it("never highlights an ambiguous or changed quotation", () => {
    expect(anchorQuote("Inspect the drive", [run("Inspect the drive"), run("Inspect the drive")], viewport).message).toContain("more than once");
    expect(anchorQuote("Inspect the motor", [run("Inspect the drive")], viewport).rects).toEqual([]);
  });
  it("fails closed for missing quote, scans, numeric-only snippets and bad geometry", () => {
    for (const quote of [null, "", "0123456789012345", "Inspect the drive"]) expect(anchorQuote(quote, [], viewport).rects).toEqual([]);
    expect(anchorQuote("Inspect the drive", [{ ...run("Inspect the drive"), width: NaN }], viewport).rects).toEqual([]);
  });
  it("does not normalize away numeric superscript meaning", () => {
    expect(anchorQuote("The area is 10 mm2.", [run("The area is 10 mm².")], viewport).rects).toEqual([]);
  });
  it("uses the PDF viewport for rotated pages", () => {
    const rotated = { width: 800, height: 600, convertToViewportPoint: (x: number, y: number) => [y,x] };
    const result = anchorQuote("Inspect the drive", [run("Inspect the drive")], rotated);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0].top).toBeCloseTo(40/600*100);
    expect(result.rects[0].height).toBeCloseTo(240/600*100);
  });
});
