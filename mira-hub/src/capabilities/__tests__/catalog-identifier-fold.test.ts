/** #5484, narrowed (PR #5500). Public fictional identifiers.
 *
 * In scope: the six hyphen equivalents of the shared detection fold, written
 * DIRECTLY between the groups of one identifier. They are compared as "-".
 *
 * Out of scope, and pinned here to the behaviour of main: a dash with a space
 * on either side, the en dash and the em dash. Those spellings keep the reading
 * they had. The blocks marked [baseline] pass on main unchanged; the blocks
 * marked [repair] fail on main for every non-ASCII spelling. */
import { describe, expect, it } from "vitest";
import { catalogIdentifierView } from "@/capabilities/catalog-identifier";
import { HYPHEN_EQUIV_CHARS } from "@/capabilities/detection-fold";
import { modelIdentitiesInText, modelMentionsInText, resolveModelFromObservationText } from "@/capabilities/model-token";
import { coverDeclaredNumbers, manualAnswersFor, modelNumbersIn, unlistedModelNumbers } from "@/capabilities/manual-applicability";
import { exactModelKey } from "@/capabilities/table-rows";

const OWN = "ZX731-04A", SIBLING = "ZX731-09C", KEY = "ZX73104A";
/** Exactly the shared fold's set, so a change there is a change here. */
const SUPPORTED = [...JSON.parse(`"${HYPHEN_EQUIV_CHARS}"`) as string];
const SPELLINGS = ["-", ...SUPPORTED];
/** Not folded: spaced dashes of every kind, en dash, em dash. */
const UNSUPPORTED = [" - ", " ‑ ", " − ", "–", " – ", "—", " — ", "- ", " -", "‑ ", " ‑"];
const spell = (identifier: string, separator: string) => identifier.replaceAll("-", separator);
const cover = (identifier: string) => `${identifier} Logic Controller\nUser Manual`;
const ask = (identifier: string, tail = "") => `For ${identifier}${tail}, which fictional indicator legend applies?`;
const keys = (text: string) => unlistedModelNumbers(text).map((number) => number.key);
const answers = (question: string, heading = cover(OWN), filename = "reference.pdf") =>
  manualAnswersFor(unlistedModelNumbers(question), heading, filename).admit;

it("the supported set is the shared fold's six hyphen equivalents", () => {
  expect(SUPPORTED).toEqual(["‐", "‑", "‒", "−", "﹣", "－"]);
});

describe.each(SPELLINGS)("[repair] an identifier written with hyphen %j", (separator) => {
  const ascii = separator === "-";
  it("has the ASCII comparison key, and keeps the label as written", () => {
    const raw = spell(OWN, separator);
    expect(modelNumbersIn(`Unit ${raw} label`)).toEqual([{ key: KEY, label: raw }]);
    expect(exactModelKey(raw)).toBe(KEY);
  });
  it("the reading the text already had is kept beside the folded one", () => {
    expect(keys(ask(spell(OWN, separator)))).toEqual(ascii ? [KEY] : [KEY, "ZX731"]);
  });
  it("its own manual answers", () => {
    expect(answers(ask(spell(OWN, separator)))).toBe(true);
  });
  it("a sibling cannot borrow the manual", () => {
    expect(answers(ask(spell(SIBLING, separator)))).toBe(false);
  });
  it("a cover or a filename spelled this way declares the full number", () => {
    expect(coverDeclaredNumbers(cover(spell(OWN, separator))).map((number) => number.key)).toContain(KEY);
    expect(answers(ask(OWN), cover(spell(OWN, separator)), `${OWN}.pdf`)).toBe(true);
    expect(answers(ask(OWN), cover(OWN), `${spell(OWN, separator)}.pdf`)).toBe(true);
    expect(answers(ask(SIBLING), cover(spell(OWN, separator)))).toBe(false);
  });
  it("a sibling cover or sibling filename does not answer for the own number", () => {
    expect(answers(ask(OWN), cover(spell(SIBLING, separator)))).toBe(false);
    expect(answers(ask(OWN), cover(OWN), `${spell(SIBLING, separator)}.pdf`)).toBe(false);
  });
  it("a known GS catalog keeps its identity and leaves no stray suffix", () => {
    const text = `Unit ${spell("GS11N-20P2", separator)}`;
    expect([...modelIdentitiesInText(text)].sort()).toEqual([...modelIdentitiesInText("Unit GS11N-20P2")].sort());
    expect(unlistedModelNumbers(text)).toEqual([]);
  });
  it("positions are positions in the text as written, after an emoji too", () => {
    const smc = spell("SMC-50", separator), first = `\u{1F50E} unit: ${smc} indication`;
    expect(modelMentionsInText(first).find((entry) => entry.id === "SMC50"))
      .toEqual({ id: "SMC50", start: first.indexOf(smc), end: first.indexOf(smc) + smc.length });
    const order = spell("6AV3182-0HX02-1BZ4", separator), second = `\u{1F50E} plate ${order}; reference`;
    const mention = modelMentionsInText(second).find((entry) => entry.id === "6AV3182-0HX02-1BZ4");
    expect(mention).toEqual({ id: "6AV3182-0HX02-1BZ4", start: second.indexOf(order), end: second.indexOf(order) + order.length });
    expect(second.slice(mention!.start, mention!.end)).toBe(order);
    expect(resolveModelFromObservationText(second)).toEqual({ model: "6AV3182-0HX02-1BZ4", ambiguous: false });
  });
  it("a counted inventory item is read, and its neighbour is refused", () => {
    expect(modelNumbersIn(`Inventory: 2 NC${separator}24 indicators`)).toEqual([{ key: "NC24", label: `NC${separator}24` }]);
    const heading = "NC-24 Indicator Module\nUser Manual";
    expect(answers(`For 2 NC${separator}24 indicators, which legend applies?`, heading, "NC-24.pdf")).toBe(true);
    expect(answers(`For 2 NC${separator}28 indicators, which legend applies?`, heading, "NC-24.pdf")).toBe(false);
  });
});

describe.each(SUPPORTED)("[repair] folding %j never admits what the text as written refused", (separator) => {
  // Main reads "ZX731<h>04A" as ZX731 and refuses the ZX735 manual. The ASCII
  // spelling is one unknown long number, which main admits (a baseline weakness,
  // listed below). The folded reading is added, never substituted, so the
  // refusal stands.
  it("a manual refused for the written reading stays refused", () => {
    expect(answers(ask(spell(OWN, separator)), cover("ZX735"), "ZX735.pdf")).toBe(false);
    expect(answers(ask(`${SIBLING}${separator}24V`))).toBe(false);
    expect(answers(ask(`ZX731${separator}24VOLTS`), cover("ZX735"), "ZX735.pdf")).toBe(false);
  });
  it("a range between two models is not welded into one number", () => {
    expect(modelNumbersIn(`RX410${separator}RX415`).map((number) => number.key)).toEqual(["RX410", "RX415"]);
  });
});

describe("[baseline] text without a supported Unicode hyphen is compared exactly as written", () => {
  const identifiers = [OWN, SIBLING, "2080-LC20-20QBB", "GS11N-20P2", "6AV3182-0HX02-1BZ4", "RX-420", "QZ-743-24AX", "NC-24", "SMC-50"];
  const tails = ["", " - 24V", " – 24V", " - 2nd alarm", " - 3PH", " - 24VOLTS", " - 3PHASE", " - what does this alarm mean?", "-24V", " — see page 4"];
  const texts = identifiers.flatMap((identifier) => ["-", ...UNSUPPORTED].flatMap((separator) =>
    tails.map((tail) => ask(spell(identifier, separator), tail))));
  it(`the comparison view is the text itself (${texts.length} generated texts)`, () => {
    expect(texts.length).toBeGreaterThan(1000);
    for (const text of texts) expect(catalogIdentifierView(text).text, text).toBe(text);
  });
  it("a folded text keeps its length, and differs only where a supported hyphen stood", () => {
    for (const separator of SUPPORTED) for (const identifier of identifiers) {
      const raw = `\u{1F50E} ${spell(identifier, separator)} – 4–20 mA — note`, view = catalogIdentifierView(raw).text;
      expect(view.length).toBe(raw.length);
      for (let at = 0; at < raw.length; at++) if (view[at] !== raw[at]) expect([raw[at], view[at]]).toEqual([separator, "-"]);
    }
  });
});

// The three findings of the review rounds on PR #5500. Each was a spaced-dash
// rule that this PR added and has now removed; each case reads as it does on main.
describe("[baseline] review regressions: a spaced dash is never a separator here", () => {
  const A = "6AV3182-0HX02-1BZ4", B = "6AV3182-0HX02-1BZ5";
  it.each([`${A} - what does this alarm mean?`, `${A} – reset procedure`, `${A} - 3rd alarm today`, `${A} - 2 pumps tripped`])(
    "round 1: prose after a dash is not part of a 6AV order number: %s", (text) => {
      expect(resolveModelFromObservationText(text)).toEqual({ model: A, ambiguous: false });
      expect([...modelIdentitiesInText(text)]).toEqual([A]);
    });
  it("round 1: two complete order numbers round a spaced dash stay two, and ambiguous", () => {
    expect(resolveModelFromObservationText(`${A} - ${B}`)).toEqual({ model: null, ambiguous: true });
    expect([...modelIdentitiesInText(`${A} - ${B}`)].sort()).toEqual([A, B]);
  });
  it.each([" - 24V", " – 24V", " ‑ 24V", " - 2nd alarm", " - 3PH", " - 480VAC", " - 5MIN", " - 24AX", " - 2 pumps tripped"])(
    "round 2: the sibling followed by %j is still the sibling, and is refused", (tail) => {
      expect(keys(ask(SIBLING, tail))).toContain("ZX73109C");
      expect(answers(ask(SIBLING, tail), cover(OWN), `${OWN}.pdf`)).toBe(false);
      expect(keys(ask(OWN, tail))).toContain(KEY);
      expect(answers(ask(OWN, tail), cover(OWN), `${OWN}.pdf`)).toBe(true);
    });
  it.each([" - 24VOLT", " - 24VOLTS", " - 3PHASE", " - 24V", " - RATED"])(
    "round 3: a bare model followed by %j is still that model, and the other model's manual is refused", (tail) => {
      expect(keys(ask("ZX731", tail))).toContain("ZX731");
      expect(answers(ask("ZX731", tail), cover("ZX735"), "ZX735.pdf")).toBe(false);
      expect(answers(ask("ZX731", tail), cover("ZX731"), "ZX731.pdf")).toBe(true);
    });
});

// What #5484 reported and this PR does NOT repair. These assertions state what
// main does today so that a later repair changes them on purpose.
describe("[baseline] OPEN in #5484: spaced-dash and en-dash spellings are still split", () => {
  it.each([" - ", " ‑ ", "–", " – "])("a sibling spelled with %j is read as the bare family number and still borrows the manual", (separator) => {
    expect(keys(ask(spell(SIBLING, separator)))).toEqual(["ZX731"]);
    expect(answers(ask(spell(SIBLING, separator)))).toBe(true);
  });
  it.each(["–", " – "])("a known GS catalog spelled with an en dash %j keeps only its family", (separator) => {
    expect(modelIdentitiesInText(`Unit ${spell("GS11N-20P2", separator)}`).has("GS11N-20P2")).toBe(false);
  });
});

describe("[baseline] existing grammars are untouched", () => {
  it.each(["GS11N\n-\n20P2", "GS11N-\n20P2", "GS11N - 20P2"])("the existing spaced or wrapped ASCII GS catalog %j is still one identity", (raw) => {
    expect(modelIdentitiesInText(raw).has("GS11N-20P2")).toBe(true);
    expect(unlistedModelNumbers(raw)).toEqual([]);
  });
  it("a supported hyphen does not fold across a line break", () => {
    expect(catalogIdentifierView("ZX731‑\n04A").text).toBe("ZX731‑\n04A");
  });
  it("ASCII comparison is case-insensitive and siblings stay distinct", () => {
    expect(modelNumbersIn(OWN.toLowerCase())[0]?.key).toBe(KEY);
    expect(answers(ask(SIBLING))).toBe(false);
    expect(answers(ask(OWN))).toBe(true);
  });
  it("fullwidth letters and digits are not turned into ASCII identifiers", () => {
    expect(modelNumbersIn("ＺＸ７３１-０４Ａ").some((number) => number.key === KEY)).toBe(false);
    expect(modelIdentitiesInText("ＧＳ１１Ｎ-２０Ｐ２").size).toBe(0);
  });
  it("ratings, standards and phase counts are not model numbers, with any hyphen", () => {
    expect(modelNumbersIn("4–20 mA; 24VDC; IP20; IEC61131; 690V; 3PH")).toEqual([]);
    for (const separator of SPELLINGS) expect(modelNumbersIn(`Loop is 4${separator}20mA at 24VDC`), separator).toEqual([]);
    for (const text of ["SMC 50 A soft starter", "SMC 3 phase supply", "PowerFlex 4 kW frame", "PF 4 HP"]) {
      expect(modelIdentitiesInText(text).size, text).toBe(0);
    }
    expect([...modelIdentitiesInText("SMC-50 rated 90 A")]).toEqual(["SMC50"]);
  });
  it.each(["-", "–", "—", "‑"])("a clause dash %s after a cover's number is not a catalog separator", (dash) => {
    expect(coverDeclaredNumbers(`${OWN} ${dash} Logic Controller\nUser Manual`).map((number) => number.key))
      .toEqual(coverDeclaredNumbers(`${OWN} - Logic Controller\nUser Manual`).map((number) => number.key));
    expect(answers(ask(OWN), `${OWN} ${dash} not covered\nUser Manual`)).toBe(answers(ask(OWN), `${OWN} - not covered\nUser Manual`));
  });
  it("counted inventory and contact counts read as before", () => {
    for (const detect of [modelNumbersIn, unlistedModelNumbers]) {
      expect(detect("Inventory: 2 RX-420 indicators")).toEqual([{ key: "RX420", label: "RX-420" }]);
      expect(detect("2 NC - 24 V DC coil")).toEqual([]);
    }
  });
  it("a publication label is not a product declaration, and prose grants no coverage", () => {
    expect(coverDeclaredNumbers("Wiring and Grounding Guidelines\nPublication NX-IN027B-EN-P\nOriginal Instructions")).toEqual([]);
    expect(answers(ask(OWN), "Reference Guide\nGeneral practice\nA ZX731-04A may be fitted in the panel.")).toBe(false);
  });
});
