/**
 * pdf-figure-lines.test.ts — figure-caption lines from PDF layout (Codex #5062 F15).
 * Synthetic text items and image boxes (invented strings, real-manual geometry: body 10pt; a
 * 171×161pt photo; its caption rows 12pt and 23pt below the photo's bottom edge, starting at its left
 * edge, in 9.5pt/8.5pt). Text is a caption only inside the band directly under an actual image; every
 * other case — including Codex round-10's smaller-font safety continuations — must come back as content.
 */
import { describe, expect, it } from "vitest";
import { figureLinesForPage, figuresForPage, imageBoxesFromOps, type ImageBox, type LayoutItem } from "../pdf-figure-lines";

const item = (str: string, y: number, size: number, x = 18, w = str.length * size * 0.5): LayoutItem => ({ str, x, y, w, size });
const body = (str: string, y: number, x = 18) => item(str, y, 10, x);
const PHOTO: ImageBox = { x0: 18, y0: 461, x1: 189, y1: 622 };

// Procedure text in the right-hand column beside the photo, plus text below it.
const STEPS = [body("1. Remove the four Bolts from the Cover.", 700, 210), body("2. Lift the Cover off the frame.", 688, 210), body("3. Set the Cover aside.", 676, 210), body("4. Clean the face of the frame.", 664, 210)];
const BELOW = [body("5. Remove the Gasket.", 380), body("6. Inspect the Gasket for cuts.", 368), body("7. Replace the Gasket if worn.", 356)];
const CAPTION = [item("9XP1000, 9XP1010", 449, 9.5), item("Removal of Cover", 438, 8.5)];
const page = (extra: LayoutItem[], images: ImageBox[] = [PHOTO]) => {
  const items = [...STEPS, ...extra, ...BELOW];
  const text = [...items].sort((a, b) => b.y - a.y).map((i) => i.str).join("\n");
  return figureLinesForPage(items, images, text);
};

describe("figureLinesForPage", () => {
  it("a two-line caption directly under a photo is a figure line (sizes 9.5 then 8.5, as in the real manual)", () => {
    expect(page(CAPTION)).toEqual(["9XP1000, 9XP1010", "Removal of Cover"]);
  });

  it("the same caption with no image on the page is content — spacing and size alone never make a caption", () => {
    expect(page(CAPTION, [])).toEqual([]);
  });

  it("Codex r10: a same-size safety continuation one row below the caption is content", () => {
    const got = page([...CAPTION, item("ONLY AFTER RELIEVING ALL SYSTEM PRESSURE (0 psi)", 428, 9.5, 18, 160)]);
    expect(got).toEqual(["9XP1000, 9XP1010", "Removal of Cover"]);
  });

  it("Codex r10: a different smaller-font continuation one row below the caption is content", () => {
    const got = page([...CAPTION, item("ONLY AFTER RELIEVING ALL SYSTEM PRESSURE (0 psi)", 428, 8, 18, 160)]);
    expect(got).toEqual(["9XP1000, 9XP1010", "Removal of Cover"]);
  });

  it("Codex r10: a smaller-font two-line CAUTION below a large gap with no photo is content", () => {
    const got = page([item("CAUTION: Before commencing with service, shut off drive (electric motor)", 300, 9, 18, 520), item("AND RELIEVE ALL DISCHARGE PRESSURE (0 psi)", 289, 9, 18, 300)], [PHOTO]);
    expect(got).toEqual([]);
  });

  it("text under the photo but wider than the photo's column (a CAUTION across the page) is content", () => {
    expect(page([item("CAUTION: Relieve all pressure before service.", 449, 9, 18, 520)])).toEqual([]);
  });

  it("caption-size text under the photo but outside its column is content", () => {
    expect(page([item("Removal of Cover", 449, 8.5, 210, 80)])).toEqual([]);
  });

  it("a body-size line in the caption band is content (the rest of a step)", () => {
    // Inside the photo's column and band, so only the size rule can reject it.
    expect(page([item("only after relieving pressure.", 449, 10, 18, 150)])).toEqual([]);
  });

  it("a row mixing caption-band text with other text is content", () => {
    expect(page([item("Removal of Cover", 449, 8.5), body("and the Gasket.", 449, 120)])).toEqual([]);
  });

  it("text above the photo is content", () => {
    expect(page([item("Removal of Cover", 630, 8.5)])).toEqual([]);
  });

  it("a small image (a rule or logo) is not a photo", () => {
    expect(page(CAPTION, [{ x0: 18, y0: 461, x1: 189, y1: 465 }])).toEqual([]);
  });

  it("an extracted line that joins caption text to other text is content", () => {
    const items = [...STEPS, ...CAPTION, ...BELOW];
    const text = [...STEPS.map((i) => i.str), "9XP1000, 9XP1010", "Removal of Cover 5. Remove the Gasket.", ...BELOW.slice(1).map((i) => i.str)].join("\n");
    expect(figureLinesForPage(items, [PHOTO], text)).toEqual(["9XP1000, 9XP1010"]);
  });

  it("no text items: no figure lines", () => {
    expect(figureLinesForPage([], [PHOTO], "")).toEqual([]);
  });
});

describe("figuresForPage", () => {
  it("each photo carries the caption rows printed under it, top to bottom", () => {
    const items = [...STEPS, ...CAPTION, ...BELOW];
    expect(figuresForPage(items, [PHOTO])).toEqual([{ box: PHOTO, caption: ["9XP1000, 9XP1010", "Removal of Cover"] }]);
  });

  it("body-size text and text outside the photo's column are not its caption; small images are not photos", () => {
    const items = [...STEPS, item("the rest of a step", 449, 10, 18, 150), item("Removal of Cover", 438, 8.5, 210, 80), ...BELOW];
    expect(figuresForPage(items, [PHOTO, { x0: 18, y0: 300, x1: 189, y1: 304 }])).toEqual([{ box: PHOTO, caption: [] }]);
  });
});

describe("imageBoxesFromOps", () => {
  const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageXObjectRepeat: 88 };

  it("an image fills its transform's unit square; save/restore scope the transform", () => {
    const boxes = imageBoxesFromOps([10, 12, 85, 11, 85], [null, [171, 0, 0, 161, 18, 461], ["img1"], null, ["img2"]], OPS);
    expect(boxes).toEqual([{ x0: 18, y0: 461, x1: 189, y1: 622, name: "img1" }, { x0: 0, y0: 0, x1: 1, y1: 1, name: "img2" }]);
  });

  it("a form XObject's matrix applies inside it and is dropped after it", () => {
    const boxes = imageBoxesFromOps([74, 12, 86, 75, 85], [[[1, 0, 0, 1, 100, 200], null], [10, 0, 0, 20, 0, 0], ["inline"], null, ["img"]], OPS);
    expect(boxes).toEqual([{ x0: 100, y0: 200, x1: 110, y1: 220 }, { x0: 0, y0: 0, x1: 1, y1: 1, name: "img" }]);
  });
});
