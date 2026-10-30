// #4870 T-2 — numeric-claim support primitives. Every example here is constructed for the
// rule it names; none is copied from the 40-turn calibration sample.
import { describe, expect, it } from "vitest";
import { appearsVerbatim, identifierAt } from "./numeric-support";

/** Offsets of the first occurrence of `num` inside `text` (the digits of one number). */
const at = (text: string, num: string, from = 0): [number, number] => {
  const s = text.indexOf(num, from);
  if (s < 0) throw new Error(`fixture: ${num} not in ${text}`);
  return [s, s + num.length];
};
const ident = (text: string, num: string, from = 0) => identifierAt(text, ...at(text, num, from));

describe("identifierAt — model, catalog, part and fault-code tokens are not numeric claims", () => {
  it("digits glued to letters on the left (a model name) are an identifier", () => {
    expect(ident("Swap the KX450 display module.", "450")).toBe(true);
  });
  it("digits glued to letters on the right (a catalog suffix) are an identifier", () => {
    expect(ident("Order the 75RQT relay base.", "75")).toBe(true);
  });
  it("a hyphen-joined catalog number is an identifier on both sides of the hyphen", () => {
    const s = "The 3150-QR40-16XYZ base is listed.";
    expect(ident(s, "3150")).toBe(true);
    expect(ident(s, "16")).toBe(true);
  });
  it("a part tag followed by a unit-looking word is still an identifier (tag-2 in)", () => {
    expect(ident("The label reads ZT88120‑4 in black.", "4")).toBe(true);
  });
  it("a zero-padded code is an identifier (fault 0042)", () => {
    expect(ident("Fault 0042 is an overvoltage trip.", "0042")).toBe(true);
    expect(ident("Code 007 means the cover is open.", "007")).toBe(true);
  });
  it("a number after a code word is an identifier when no unit follows", () => {
    expect(ident("Alarm 31 clears after reset.", "31")).toBe(true);
    expect(ident("Set parameter 118 to the motor value.", "118")).toBe(true);
  });
  it("a number after an all-caps family prefix is an identifier when no unit follows", () => {
    expect(ident("Check the QM 210-4 interface module.", "210")).toBe(true);
  });
  // Controls — true quantities stay claims.
  it("CONTROL: a spaced quantity with a unit is a claim, even right after a model token", () => {
    const s = "The KM-3 30 A breaker feeds the panel.";
    expect(ident(s, "30")).toBe(false);
  });
  it("CONTROL: a glued unit (24V, 1.5A, 60Hz) is a claim, not a code suffix", () => {
    expect(ident("Output 24V/1.5A at 60Hz.", "24")).toBe(false);
    expect(ident("Output 24V/1.5A at 60Hz.", "1.5")).toBe(false);
    expect(ident("Output 24V/1.5A at 60Hz.", "60")).toBe(false);
  });
  it("CONTROL: a hyphenated unit word (12-volt) is a claim", () => {
    expect(ident("Use a 12-volt lamp.", "12")).toBe(false);
  });
  it("CONTROL: a plain range and a slash pair stay claims", () => {
    expect(ident("Use positions 2–6 only.", "6")).toBe(false);
    expect(ident("Rated 110/220 V.", "220")).toBe(false);
  });
  it("CONTROL: a code word followed by a unit is a quantity (fault current 8 A)", () => {
    expect(ident("Fault 8 A trips the breaker.", "8")).toBe(false);
  });
  it("CONTROL: a decimal with a leading zero is not a padded code", () => {
    expect(ident("Gap is 0.35 mm.", "0.35")).toBe(false);
  });
});

describe("appearsVerbatim — a number is supported when it appears verbatim in the text", () => {
  it("matches across unit spacing and case (36 V DC ⇔ 36VDC)", () => {
    expect(appearsVerbatim("36 V DC", ["Supply: 36VDC nominal"])).toBe(true);
  });
  it("a bare-volt claim is supported by an AC/DC-marked source (36 V ⇔ 36 V DC)", () => {
    expect(appearsVerbatim("36 V", ["Supply 36 V DC nominal"])).toBe(true);
  });
  it("matches a range across dash styles (3–9 ⇔ 3-9)", () => {
    expect(appearsVerbatim("3–9", ["valid settings 3-9 inclusive"])).toBe(true);
  });
  it("matches a unitless number that is literally present", () => {
    expect(appearsVerbatim("13", ["the default value is 13."])).toBe(true);
  });
  it("normalizes the degree sign (55 °C ⇔ 55℃)", () => {
    expect(appearsVerbatim("55 °C", ["max ambient 55℃"])).toBe(true);
  });
  it("is not fooled by a longer number (13 is not in 113 or 1.13)", () => {
    expect(appearsVerbatim("13", ["value 113 here and 1.13 there"])).toBe(false);
  });
  it("is not fooled by a letter-glued code (13 is not in P13)", () => {
    expect(appearsVerbatim("13", ["see P13"])).toBe(false);
  });
  it("is not fooled by a decimal continuation (13 is not 13.5)", () => {
    expect(appearsVerbatim("13 V", ["rated 13.5 V"])).toBe(false);
  });
  it("a positive value is not supported by its negative (25 °C vs -25 °C)", () => {
    expect(appearsVerbatim("25 °C", ["storage down to -25 °C"])).toBe(false);
  });
  it("a different unit does not support (36 V is not 36 A)", () => {
    expect(appearsVerbatim("36 V", ["36 A max"])).toBe(false);
  });
  it("searches every text given (chunks and observations alike)", () => {
    expect(appearsVerbatim("4.5A", ["nothing here", "label: 4.5A max"])).toBe(true);
  });
  it("a claim without digits is never verbatim support", () => {
    expect(appearsVerbatim("V", ["V"])).toBe(false);
  });
});
