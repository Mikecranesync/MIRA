// A photo reading, a confirmed nameplate and a photo's OCR text are judged by
// what was read off the photo, not by a cover. That treatment is for documents
// the PRODUCT wrote. Their opening lines are ordinary text: anyone can type
// them at the top of a file and upload it. So the opening line only says which
// shape a text has; who wrote it comes from the upload records, and a text
// with no such record is judged like any other upload, by its cover.
import { describe, expect, it } from "vitest";

import { coverDeclaredNumbers, manualAnswersFor, manualCoversNumber, unlistedModelNumbers } from "../manual-applicability";
import {
  NAMEPLATE_BODY_MARK,
  NAMEPLATE_OPENER,
  PHOTO_OCR_OPENER_START,
  PHOTO_READING_BODY_MARK,
  PHOTO_READING_OPENER,
  type PhotoDocumentKind,
  photoDocumentShape,
  productWrittenBody,
} from "../photo-document-text";

const SIBLING_COVER = "Northfield RX410 Logic Controller\nHardware User Guide";
const MENTION = "This guide is sometimes kept beside the RX420 on the same line.";

/** A typed file: the sibling's cover, a passing mention of the asked model, and a product opener pasted on top. */
const DRESSED: Array<[string, PhotoDocumentKind, string]> = [
  ["a kept photo reading", "photo_text", `${PHOTO_READING_OPENER}\n${SIBLING_COVER}\n${PHOTO_READING_BODY_MARK}\n${MENTION}`],
  ["a confirmed nameplate", "nameplate_text", `${NAMEPLATE_OPENER}\n${SIBLING_COVER}\n${NAMEPLATE_BODY_MARK}\n${MENTION}`],
  ["a photo's OCR text", "photo_ocr", `${PHOTO_OCR_OPENER_START}x.jpg" (OCR, 90% confidence):\n${SIBLING_COVER}\n${MENTION}`],
];
const ASKED = unlistedModelNumbers("RX420 supply voltage?");

describe("the opening line says which shape a text has, never who wrote it", () => {
  it.each(DRESSED)("shape of %s", (_name, kind, text) => {
    expect(photoDocumentShape(text)).toBe(kind);
  });

  it("an ordinary manual has no such shape, wherever the product's lines appear below its first", () => {
    expect(photoDocumentShape(SIBLING_COVER)).toBeNull();
    expect(photoDocumentShape(`${SIBLING_COVER}\n${PHOTO_READING_OPENER}\n${PHOTO_READING_BODY_MARK}\nRX420`)).toBeNull();
  });

  it.each(DRESSED)("the reading of %s is given only for the kind the records name", (_name, kind, text) => {
    expect(productWrittenBody(text, kind)).toContain("RX420");
    expect(productWrittenBody(text, null)).toBeNull();
    for (const other of ["photo_text", "nameplate_text", "photo_ocr"] as const) {
      if (other !== kind) expect(productWrittenBody(text, other)).toBeNull();
    }
  });
});

describe("a typed file that opens like the product's own photo document", () => {
  it.each(DRESSED)("dressed as %s: with no record that the product wrote it, its cover decides", (_name, _kind, text) => {
    const verdict = manualAnswersFor(ASKED, text, "notes.txt");
    expect(verdict).toMatchObject({ admit: false, kind: "other-model", asked: ["RX420"], declared: ["RX410"] });
    expect(verdict).not.toHaveProperty("reading");
    expect(manualCoversNumber(ASKED[0], text, "notes.txt")).toBe(false);
    expect(coverDeclaredNumbers(text).map((n) => n.label)).toEqual(["RX410"]);
  });

  it.each(DRESSED)("dressed as %s: a record of a DIFFERENT product-written kind does not vouch for it either", (_name, kind, text) => {
    const other = kind === "photo_text" ? "nameplate_text" : "photo_text";
    expect(manualAnswersFor(ASKED, text, "notes.txt", other)).toMatchObject({ admit: false, kind: "other-model", declared: ["RX410"] });
  });

  // The other half, so the rule above is not simply "never trust": the same
  // words in a document the records say the product wrote ARE a reading.
  it.each(DRESSED)("the same text recorded as %s is read as a reading", (_name, kind, text) => {
    expect(manualAnswersFor(ASKED, text, "notes.txt", kind)).toEqual({ admit: true });
    expect(coverDeclaredNumbers(text, kind)).toEqual([]);
  });
});
