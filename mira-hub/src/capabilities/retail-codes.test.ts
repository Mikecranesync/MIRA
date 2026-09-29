import { describe, expect, it } from "vitest";

import { RETAIL_CODE_NOTE, showsRetailCode, withRetailCodeNote } from "./retail-codes";

// The exact wording the #4133 A/B measured (12/15 → 2/15). A change reopens it.
const TESTED_NOTE = "RETAIL AND WAREHOUSE CODES on packaging labels are not part numbers: an Amazon FNSKU (\"X00\" followed by 7 letters or digits, printed under a barcode), an LPN, or a long hyphenated or numeric tracking code identifies the store listing or the carton, not the part. The manufacturer's part number is the code printed with the product description (for example \"<code> Tapered Roller Bearing\"). If that code looks misread or incomplete, give it as printed and say it should be checked against the part itself.";

describe("retail codes (#4133)", () => {
  it("pins the note to the wording that was measured", () => {
    expect(RETAIL_CODE_NOTE).toBe(TESTED_NOTE);
  });

  it.each([
    'printed text reading: "*X0026EG7QS*", "S19051600ux09961"',
    'the barcode "*X0026E67QS*" and "32906X Tapered Roller Bea.."',
    "FNSKU X00ABC1234 under the barcode",
  ])("detects an FNSKU: %s", (t) => expect(showsRetailCode(t)).toBe(true));

  it.each([
    "SIEMENS, TP700 Comfort, 1P 6AV2124-0GC01-0AX0",
    "STEPPERONLINE, P/N: MG17-G20",
    "model AX0026E67QS",
    "X0026E67Q",
    "X0026E67QS9",
    "x0026e67qs",
    "",
  ])("control — no FNSKU: %s", (t) => expect(showsRetailCode(t)).toBe(false));

  it("appends the note only when the photo context shows an FNSKU, byte-identical otherwise", () => {
    expect(withRetailCodeNote("SYS", "label *X0026E67QS*")).toBe(`SYS\n\n${TESTED_NOTE}`);
    expect(withRetailCodeNote("SYS", "P/N: MG17-G20")).toBe("SYS");
  });
});
