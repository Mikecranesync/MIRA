/** Public fictional identifiers; detection/comparison only, never whole-string
 * Unicode normalization or a reason to rewrite technician-facing source text. */
import { describe, expect, it } from "vitest";
import { modelIdentitiesInText, modelMentionsInText } from "@/capabilities/model-token";
import { coverDeclaredNumbers, manualAnswersFor, modelNumbersIn, unlistedModelNumbers } from "@/capabilities/manual-applicability";
import { exactModelKey } from "@/capabilities/table-rows";

const OWN = "ZX731-04A", SIBLING = "ZX731-09C", KEY = "ZX73104A";
const variants = ["-", "\u2011", "\u2013", " - ", " \u2011 ", " \u2013 "];
const spell = (identifier: string, separator: string) => identifier.replaceAll("-", separator);
const cover = (identifier: string) => `${identifier} Logic Controller\nUser Manual`;
const asked = (identifier: string) => unlistedModelNumbers(`Which fictional indicator belongs to ${identifier}?`);
const result = (question: string, heading = cover(OWN), filename = "reference.pdf") => manualAnswersFor(asked(question), heading, filename);

describe.each(variants)("catalog detection uses identifier separator %j", (separator) => {
  it("keeps one full fictional catalog key and the raw printed label", () => {
    const raw = spell(OWN, separator), numbers = modelNumbersIn(`Unit ${raw} label`);
    expect(numbers.map((number) => number.key)).toEqual([KEY]);
    expect(numbers[0]?.label).toBe(raw);
    expect(exactModelKey(raw)).toBe(KEY);
  });
  it("the own question is covered identically to its ASCII spelling", () => {
    expect(asked(spell(OWN, separator)).map((number) => number.key)).toEqual([KEY]);
    expect(result(spell(OWN, separator))).toEqual({ admit: true });
  });
  it("a sibling question cannot borrow the own manual", () => {
    expect(result(SIBLING).admit, "ASCII sibling already refuses").toBe(false);
    expect(result(spell(SIBLING, separator)).admit).toBe(false);
  });
  it("own cover and filename agree across separator spellings", () => {
    expect(result(OWN, cover(spell(OWN, separator)), `${OWN}.pdf`)).toEqual({ admit: true });
    expect(result(OWN, cover(OWN), `${spell(OWN, separator)}.pdf`)).toEqual({ admit: true });
  });
  it("a sibling cover or mismatched sibling filename cannot acquire own coverage", () => {
    expect(result(OWN, cover(spell(SIBLING, separator))).admit).toBe(false);
    expect(result(OWN, cover(OWN), `${spell(SIBLING, separator)}.pdf`).admit).toBe(false);
  });
  it("known exact GS catalogs retain the same canonical identity set", () => {
    expect([...modelIdentitiesInText(`Unit ${spell("GS11N-20P2", separator)}`)].sort())
      .toEqual([...modelIdentitiesInText("Unit GS11N-20P2")].sort());
    expect(unlistedModelNumbers(`Unit ${spell("GS11N-20P2", separator)}`)).toEqual([]);
  });
  it("close-name SMC detection retains raw UTF-16 offsets after an emoji", () => {
    const raw = spell("SMC-50", separator), text = `🔎 unit: ${raw} indication`;
    const mention = modelMentionsInText(text).find((entry) => entry.id === "SMC50");
    expect(mention).toEqual({ id: "SMC50", start: text.indexOf(raw), end: text.indexOf(raw) + raw.length });
    expect(text.slice(mention!.start, mention!.end)).toBe(raw);
    expect([...modelIdentitiesInText(text)]).toEqual(["SMC50"]);
  });
  it("a full known catalog mention keeps source offsets when separator spacing changes", () => {
    const raw = spell("6AV3182-0HX02-1BZ4", separator), text = `🔎 plate ${raw}; reference`;
    const mention = modelMentionsInText(text).find((entry) => entry.id === "6AV3182-0HX02-1BZ4");
    expect(mention).toEqual({ id: "6AV3182-0HX02-1BZ4", start: text.indexOf(raw), end: text.indexOf(raw) + raw.length });
    expect(text.slice(mention!.start, mention!.end)).toBe(raw);
  });
});

describe("identifier-only boundaries preserve conservative existing grammars", () => {
  // Existing GS ASCII matching permits whitespace around its literal hyphen,
  // including extraction line wraps. This does not extend Unicode folding
  // across newlines: the identifier-only fold remains horizontal in scope.
  it.each(["GS11N\n-\n20P2", "GS11N-\n20P2"])("preserves the existing wrapped ASCII GS catalog %j without an orphan suffix", (raw) => {
    const original = raw;
    expect([...modelIdentitiesInText(raw)].sort()).toEqual([...modelIdentitiesInText("GS11N-20P2")].sort());
    expect(modelIdentitiesInText(raw).has("GS11N-20P2")).toBe(true);
    expect(unlistedModelNumbers(raw)).toEqual([]);
    expect(raw).toBe(original);
  });
  it("preserves case-insensitive ASCII comparison and distinguishable sibling keys", () => {
    expect(modelNumbersIn(OWN.toLowerCase())[0]?.key).toBe(KEY);
    expect(result(SIBLING).admit).toBe(false);
    expect(result("ZX731-04A")).toEqual({ admit: true });
  });
  it("does not turn fullwidth or compatibility text into ASCII identifiers", () => {
    expect(modelNumbersIn("ＺＸ７３１-０４Ａ").some((number) => number.key === KEY)).toBe(false);
    expect(modelIdentitiesInText("ＧＳ１１Ｎ-２０Ｐ２").size).toBe(0);
    expect(exactModelKey("ＺＸ７３１-０４Ａ")).not.toBe(KEY);
  });
  it("keeps ratings, standards and phase counts out of model identities", () => {
    expect(modelNumbersIn("4–20 mA; 24VDC; IP20; IEC61131; 690V; 3PH")).toEqual([]);
    for (const text of ["SMC 50 A soft starter", "SMC 3 phase supply", "PowerFlex 4 kW frame", "PF 4 HP"]) {
      expect(modelIdentitiesInText(text).size, text).toBe(0);
    }
    expect([...modelIdentitiesInText("SMC-50 rated 90 A")]).toEqual(["SMC50"]);
  });
  it.each(["–", "—", "‑"])("keeps a prose clause dash %s distinct from a catalog separator", (dash) => {
    const ascii = `${OWN} - not covered\nUser Manual`;
    expect(result(OWN, `${OWN} ${dash} not covered\nUser Manual`).admit).toBe(result(OWN, ascii).admit);
    expect(result(OWN, `${OWN} ${dash} Logic Controller\nUser Manual`).admit)
      .toBe(result(OWN, `${OWN} - Logic Controller\nUser Manual`).admit);
  });
  // Preserve the existing conservative title grammar: ASCII/en prose-dash
  // forms do not establish this range's coverage, while no-break/minus range
  // forms declare both endpoints. Identifier folding must not flatten clauses.
  it.each([
    ["-", []], ["–", []], ["‑", ["ZX730", "ZX739"]], ["−", ["ZX730", "ZX739"]],
  ] as const)("preserves existing range/title classification for dash %s", (dash, expected) => {
    expect(coverDeclaredNumbers(`ZX730 ${dash} ZX739 Logic Controllers\nUser Manual`).map((number) => number.key))
      .toEqual(expected);
  });
  it("does not make an ASCII publication label a product declaration", () => {
    expect(coverDeclaredNumbers("Wiring and Grounding Guidelines\nPublication NX-IN027B-EN-P\nOriginal Instructions")).toEqual([]);
  });
  it("keeps unrelated model keys distinct and does not grant coverage from running prose", () => {
    expect(modelNumbersIn("PL812-09C")[0]?.key).not.toBe(KEY);
    expect(result(OWN, "Reference Guide\nGeneral practice\nA ZX731-04A may be fitted in the panel.").admit).toBe(false);
  });
});


describe("counted inventory preserves complete identifier runs", () => {
  it.each(variants)("retains NC24 after an inventory count with separator %j", (separator) => {
    const raw = `NC${separator}24`, text = `Inventory: 2 ${raw} indicators`;
    for (const detect of [modelNumbersIn, unlistedModelNumbers]) {
      expect.soft(detect(text)).toEqual([{ key: "NC24", label: raw }]);
    }
  });
  it("retains the existing counted RX-420 identifier", () => {
    for (const detect of [modelNumbersIn, unlistedModelNumbers]) {
      expect(detect("Inventory: 2 RX-420 indicators")).toEqual([{ key: "RX420", label: "RX-420" }]);
    }
  });
  it("keeps a spaced contact count followed by voltage as count/unit prose", () => {
    for (const detect of [modelNumbersIn, unlistedModelNumbers]) {
      expect(detect("2 NC - 24 V DC coil")).toEqual([]);
    }
  });
});
