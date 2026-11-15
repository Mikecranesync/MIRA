/** Public fictional identifiers; detection/comparison only, never whole-string
 * Unicode normalization or a reason to rewrite technician-facing source text. */
import { describe, expect, it } from "vitest";
import { modelIdentitiesInText, modelMentionsInText, resolveModelFromObservationText } from "@/capabilities/model-token";
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

// Review finding F1 on PR 5500 (ledger 6892548431): the spaced-separator form of a 6AV order
// number must stop at the order number. It may not swallow the clause after a dash, and it
// may not weld two complete order numbers into one.
describe("a spaced 6AV separator stops at the order number", () => {
  const A = "6AV3182-0HX02-1BZ4", B = "6AV3182-0HX02-1BZ5";
  it.each([
    `${A} - what does this alarm mean?`,
    `${A} – reset procedure`,
    `${A} - 3rd alarm today`,
    `${A} - 2 pumps tripped`,
  ])("prose after a dash is not part of the identity: %s", (text) => {
    expect(resolveModelFromObservationText(text)).toEqual({ model: A, ambiguous: false });
    expect([...modelIdentitiesInText(text)]).toEqual([A]);
  });
  it("two complete order numbers joined by a spaced dash stay two, and ambiguous", () => {
    const text = `${A} - ${B}`;
    expect(resolveModelFromObservationText(text)).toEqual({ model: null, ambiguous: true });
    expect([...modelIdentitiesInText(text)].sort()).toEqual([A, B]);
  });
  it("control: the spaced spelling of ONE order number is still read as that order number", () => {
    expect(resolveModelFromObservationText("6AV3182 - 0HX02 - 1BZ4")).toEqual({ model: A, ambiguous: false });
    expect(resolveModelFromObservationText("plate 6AV3182 - 0HX02 - 1BZ4 - what is this?")).toEqual({ model: A, ambiguous: false });
  });
  it("control: the unspaced order number is unchanged", () => {
    expect(resolveModelFromObservationText(`${A} fault`)).toEqual({ model: A, ambiguous: false });
    expect(resolveModelFromObservationText(`The panel is a ${A}.`)).toEqual({ model: A, ambiguous: false });
    expect(resolveModelFromObservationText("6AV2124.0GC01-0AX0 panel")).toEqual({ model: "6AV2124.0GC01-0AX0", ambiguous: false });
  });
});

// Review finding F4 on PR 5500 (ledger 6892789648): a spaced dash is either a catalog
// separator or a clause dash, and the text cannot say which. The shorter reading is read
// as well, wherever a number is asked about or declared, so a tail can never hide a sibling.
describe("a spaced dash is read both ways, and either reading can refuse", () => {
  const ask = (tail: string, catalog = SIBLING) => `For ${catalog}${tail}, which fictional indicator legend applies?`;
  const keys = (text: string) => unlistedModelNumbers(text).map((number) => number.key);
  const answers = (text: string, own = OWN) => manualAnswersFor(unlistedModelNumbers(text), cover(own), `${own}.pdf`).admit;
  const tails = [" - 24V", " \u2013 24V", " \u2011 24V", " - 2nd alarm", " - 3PH", " - 2 pumps tripped", " - 480VAC",
    " - 5min delay", " - 100mm rail", " - 24 V supply", " - 5MIN", " - 2NO", " - 100MM", " - 60C", " - 12AWG", " - 3P", " - 2X", " - 24VOLT", " - 24AX"];
  it.each(tails)("the sibling with tail %j is still read as the sibling and cannot borrow the own manual", (tail) => {
    for (const catalog of [SIBLING, "ZX731 - 09C"]) {
      expect(keys(ask(tail, catalog)), catalog).toContain("ZX73109C");
      expect(answers(ask(tail, catalog)), catalog).toBe(false);
    }
  });
  // A tail of one or two characters makes the long reading a look-alike variant of the own
  // number ("ZX73104A2X"). Written with unspaced hyphens first, the change of style marks the
  // tail as prose and the own manual answers. Written fully spaced, nothing tells a variant
  // from a clause, so the manual is withheld: a known limit that fails closed.
  const shortTails = new Set([" - 2 pumps tripped", " - 24 V supply", " - 3P", " - 2X"]);
  it.each(tails)("control: the own model with tail %j is still read as the own model", (tail) => {
    expect(keys(ask(tail, OWN))).toContain(KEY);
    expect(keys(ask(tail, "ZX731 - 04A"))).toContain(KEY);
    expect(answers(ask(tail, "ZX731 - 04A"))).toBe(!shortTails.has(tail));
    expect(answers(ask(tail, OWN))).toBe(true);
  });
  it("a bare model followed by a spaced rating is still read as that model", () => {
    expect(keys(ask(" - 24V", "ZX731"))).toContain("ZX731");
    expect(manualAnswersFor(unlistedModelNumbers(ask(" - 24V", "ZX731")), "ZX735 Logic Controller\nUser Manual", "ZX735.pdf").admit).toBe(false);
    expect(manualAnswersFor(unlistedModelNumbers(ask(" - 24V", "ZX731")), "ZX731 Logic Controller\nUser Manual", "ZX731.pdf").admit).toBe(true);
  });
  describe.each(variants)("siblings that differ only in a rating-shaped suffix, separator %j", (separator) => {
    it.each([["ZX731-10A", "ZX731-20A"], ["ZX731-24V", "ZX731-48V"], ["ZX731-3PH", "ZX731-1PH"], ["ZX731-24", "ZX731-48"]])(
      "%s manual answers itself and refuses %s", (own, sibling) => {
        expect(answers(ask("", spell(own, separator)), own)).toBe(true);
        expect(answers(ask("", spell(sibling, separator)), own)).toBe(false);
      });
  });
  it("a cover with prose after a spaced dash still declares its model and refuses the sibling", () => {
    const heading = "ZX731-04A - 24V LOGIC CONTROLLER\nUser Manual";
    expect(coverDeclaredNumbers(heading).map((number) => number.key)).toEqual([KEY]);
    expect(manualAnswersFor(unlistedModelNumbers(ask("", OWN)), heading, "reference.pdf")).toEqual({ admit: true });
    expect(manualAnswersFor(unlistedModelNumbers(ask("", SIBLING)), heading, "reference.pdf").admit).toBe(false);
  });
  // Known limit, failing closed: a cover written fully spaced with a further tail is not
  // read as a title, so it shows coverage for no one. It must never answer the sibling.
  it.each(["ZX731 - 04A - 24V Logic Controller\nUser Manual", "ZX731 - 04A - 2NO CONTACTS\nUser Manual"])(
    "a fully spaced cover with a tail never answers the sibling: %j", (heading) => {
      expect(manualAnswersFor(unlistedModelNumbers(ask("", SIBLING)), heading, "reference.pdf").admit).toBe(false);
      expect(manualAnswersFor(unlistedModelNumbers(ask("", OWN)), heading, "reference.pdf").admit).toBe(false);
    });
  it("control: one consistently spaced number is one number, with no extra reading", () => {
    expect(keys(ask("", "ZX731 - 04A"))).toEqual([KEY]);
    expect(modelNumbersIn("Unit QZ - 743 - 24AX label").map((number) => number.key)).toEqual(["QZ74324AX"]);
    expect(modelNumbersIn("Inventory: 2 NC - 24 indicators").map((number) => number.key)).toEqual(["NC24"]);
  });
  it("control: unspaced numbers are unchanged and gain no extra reading", () => {
    expect(keys(ask("", "QZ-743-24AX"))).toEqual(["QZ74324AX"]);
    expect(keys(ask("", "ZX731-09C-24V"))).toEqual(["ZX73109C24V"]);
  });
});
