import { describe, expect, it } from "vitest";

import { LABEL_DATA_IDENTIFIER_NOTE, showsLabelDataIdentifier, withLabelDataIdentifiers } from "./label-data-identifiers";

// The note is the exact artifact the #4131 A/B measured (0/5 "single-phase", 5/5
// correct). Any wording change reopens that measurement — pin it.
const TESTED_NOTE = "LABEL DATA IDENTIFIERS (ANSI MH10.8.2 / ISO/IEC 15418, used on industrial product labels): a short prefix printed before a value names that value \u2014 \"1P\" = the supplier's part (order) number, \"S\" = serial number, \"Q\" = quantity, \"4L\" = country of origin, \"10D\" = date code. The prefix is not part of the value and says nothing about the product's electrical supply or configuration.";

describe("label data identifiers (#4131)", () => {
  it("pins the note to the wording that was measured", () => {
    expect(LABEL_DATA_IDENTIFIER_NOTE).toBe(TESTED_NOTE);
  });

  it.each([
    "The label reads: SIEMENS, TP700 Comfort, 1P 6AV2124-0GC01-0AX0, S LBS3073983",
    "1P6ES7214-1AG40-0XB0 printed under the barcode",
    "Order code (1P 3RT2016-1BB41)",
  ])("detects a 1P field: %s", (text) => expect(showsLabelDataIdentifier(text)).toBe(true));

  it.each([
    "STEPPERONLINE, P/N: MG17-G20, 20:1 45arcmin IP54",
    "a 1P breaker rated C16 feeds the panel",
    "1P MCB and 3P MCB in the enclosure",
    "the 1p connector",
    "model X1P22000 on the plate",
    "",
  ])("control — no 1P field: %s", (text) => expect(showsLabelDataIdentifier(text)).toBe(false));

  it("appends the note only when the photo context shows a 1P field, and is byte-identical otherwise", () => {
    expect(withLabelDataIdentifiers("SYS", "label: 1P 6AV2124-0GC01-0AX0")).toBe(`SYS\n\n${TESTED_NOTE}`);
    expect(withLabelDataIdentifiers("SYS", "P/N: MG17-G20")).toBe("SYS");
    expect(withLabelDataIdentifiers("SYS", "")).toBe("SYS");
  });
});
