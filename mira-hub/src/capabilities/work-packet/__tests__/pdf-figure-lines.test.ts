/**
 * pdf-figure-lines.test.ts — figure-caption lines from PDF layout (Codex #5062 F15).
 * Synthetic text items (invented strings, real-manual geometry: body 10pt, captions 9.5pt under a
 * ~200pt photo, CAUTION ~30pt below the text above it). Every case that is not plainly a caption must
 * come back as content.
 */
import { describe, expect, it } from "vitest";
import { figureLinesForPage, type LayoutItem } from "../pdf-figure-lines";

const H = 792;
const body = (str: string, y: number): LayoutItem => ({ str, y, size: 10 });
const cap = (str: string, y: number): LayoutItem => ({ str, y, size: 9.5 });

// A page of procedure text, then a photo (y 640 → 440), then its two-line caption, then more steps.
const STEPS_ABOVE = [body("1. Remove the four Bolts from the Cover.", 700), body("2. Lift the Cover off the frame.", 688), body("3. Set the Cover aside.", 676), body("4. Clean the face of the frame.", 664)];
const STEPS_BELOW = [body("5. Remove the Gasket.", 400), body("6. Inspect the Gasket for cuts.", 388), body("7. Replace the Gasket if worn.", 376)];
const text = (lines: string[]) => lines.join("\n");

describe("figureLinesForPage", () => {
  it("a two-line caption under a photo gap is a figure line", () => {
    const items = [...STEPS_ABOVE, cap("9XP1000, 9XP1010", 440), cap("Removal of Cover", 430), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "9XP1000, 9XP1010", "Removal of Cover", ...STEPS_BELOW.map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual(["9XP1000, 9XP1010", "Removal of Cover"]);
  });

  it("a non-body line with ordinary spacing above it (a CAUTION) is content", () => {
    const items = [...STEPS_ABOVE, cap("CAUTION: Relieve all pressure before service.", 634), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "CAUTION: Relieve all pressure before service.", ...STEPS_BELOW.map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual([]);
  });

  it("a body-size line under a photo gap is content (a heading, or the rest of a step)", () => {
    const items = [...STEPS_ABOVE, body("only after relieving all system pressure.", 440), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "only after relieving all system pressure.", ...STEPS_BELOW.map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual([]);
  });

  it("a row mixing caption-size and body-size text is content", () => {
    const items = [...STEPS_ABOVE, cap("Removal of Cover", 440), body("and the Gasket.", 440), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "Removal of Cover and the Gasket.", ...STEPS_BELOW.map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual([]);
  });

  it("a caption-size line too far below the caption is not part of it", () => {
    const items = [...STEPS_ABOVE, cap("Removal of Cover", 440), cap("ONLY AFTER RELIEVING PRESSURE", 410), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "Removal of Cover", "ONLY AFTER RELIEVING PRESSURE", ...STEPS_BELOW.map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual(["Removal of Cover"]);
  });

  it("an extracted line that joins caption text to other text is content", () => {
    const items = [...STEPS_ABOVE, cap("Removal of Cover", 440), ...STEPS_BELOW];
    const pageText = text([...STEPS_ABOVE.map((i) => i.str), "Removal of Cover 5. Remove the Gasket.", ...STEPS_BELOW.slice(1).map((i) => i.str)]);
    expect(figureLinesForPage(items, H, pageText)).toEqual([]);
  });

  it("no text items: no figure lines", () => {
    expect(figureLinesForPage([], H, "")).toEqual([]);
  });
});
