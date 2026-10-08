// #4315 — answer-aware citation quotes. Fixtures: the real staging chunks of turn ca12abb8
// (Rockwell 520-PC001 p.1: 142ed933 holds the torque table, ae744613 the Fuses/Wiring text).
import { describe, expect, it } from "vitest";
import { relevantQuoteWindow } from "../lib/quote-window";
import { assignValues, MODEL_VISIBLE_CHARS, supportingQuote, withSupportingQuotes } from "./supporting-quote";

const VALUE_CHUNK = "R+, BR- Dynamic Brake Resistor Connection\nSafety Ground – PE\nIMPORTANT Terminal screws may become loose during shipment. Verify that all\nterminal screws are tightened to the recommended torque before\nyou apply power to the drive.\nFrame Maximum Wire Size(1)\n(1) Maximum/minimum sizes that the terminal block accepts. These are not recommendations.\nMinimum Wire Size(1) Torque\nA 5.3 mm2 (10 AWG) 0.8 mm2 (18 AWG) 1.76…2.16 N•m (15.6…19.1 lb•in)\nB 8.4 mm2 (8 AWG) 2.1 mm2 (14 AWG) 1.76…2.16 N•m (15.6…19.1 lb•in)\nC 8.4 mm2 (8 AWG) 2.1 mm2 (14 AWG) 1.76…2.16 N•m (15.6…19.1 lb•in)\nD 13.3 mm2 (6 AWG) 5.3 mm2 (10 AWG) 1.76…2.16 N•m (15.6…19.1 lb•in)\nE 26.7 mm2 (3 AWG) 8.4 mm2 (8 AWG) 3.09…3.77 N•m (27.3…33.4 lb•in)\nFuses and Circuit Breakers – UL 61800-5-1 Applications (Continued)\nCatalog No.(1) Output Ratings Input Ratings Branch Circuit Protection\nIP20/Open Type\nWatts LossNormal\nDuty\nHeavy\nDuty\nAmps\nVoltage\nRange\nkVA\nMax Amps(2)\nFuse Ratings\nMin/Max\n140M/MT\nMotor\nProtectors\n(3) (4) (5)\nContactors";
const FUSES_CHUNK = "owerFlex® 520-series Adjustable Frequency AC Drive User Manual for instructions on how\nto comply with the EMC Directive. Dimensions are in mm and (in.).\nFuses and Circuit Breakers\nSee the PowerFlex 520-series Adjustable Frequency AC Drive User Manual for fuses and circuit\nbreakers for non-UL applications.\nWiring\nSee the PowerFlex 520-series Adjustable Frequency AC Drive User Manual for instructions on how\nto wire the power terminals and control terminals.\nPower Wiring\nRecommended Shielded Wire\nPower Terminal Block\nPower Terminal Block Specifications\nATTENTION:\nBefore installing, configuring, operating, or maintaining this product,\nread this document and the documents that are listed in the Additional\nResources section for installing, configuring, or operating equipment.\nUsers should familiarize themselves with installation and wiring\ninstructions in addition to requirements of all applicable codes, laws,\nand standards.\nInstallation, adjustments, putting into service, use, assembly, dis";
const Q_TORQUE = "What is the terminal block screw torque on PowerFlex 525?";
// The answer the staging turn actually produced (gpt-oss-120b), Unicode spacing preserved.
const REAL_ANSWER =
  "The terminal‑block screw torque for the PowerFlex 525 is 1.76 – 2.16 N·m (≈15.6 – 19.1 lb·in) [2]. This is the recommended tightening torque for all terminal screws on the drive.";
const assigned = (answer: string, question = "") =>
  Object.fromEntries([...assignValues(answer, question)].map(([k, v]) => [k, v.map((x) => x.text.trim())]));
const verbatim = (quote: string, chunks: string[]) =>
  chunks.some((c) => c.slice(0, MODEL_VISIBLE_CHARS).includes(quote.replace(/^…/, "")));

describe("the reported failure (staging turn ca12abb8)", () => {
  it("[2] is quoted on the torque row even though the Fuses chunk comes first", () => {
    const r = supportingQuote([FUSES_CHUNK, VALUE_CHUNK], REAL_ANSWER, "2", Q_TORQUE);
    expect(r.quote).toContain("1.76…2.16 N•m");
    expect(r.support).toBe("claim");
    expect(r.unsupported).toEqual([]);
    expect(verbatim(r.quote ?? "", [FUSES_CHUNK, VALUE_CHUNK])).toBe(true);
  });
  it("chunk order does not change the quote", () => {
    expect(supportingQuote([VALUE_CHUNK, FUSES_CHUNK], REAL_ANSWER, "2", Q_TORQUE).quote).toContain("1.76…2.16 N•m");
  });
  it("the model number is not a claim value; both unit systems are", () => {
    expect(assigned(REAL_ANSWER, Q_TORQUE)).toEqual({
      "2": ["1.76 – 2.16 N·m", "15.6 – 19.1 lb·in"],
    });
  });
});

describe("numbers before, after and around the marker", () => {
  it("before", () => expect(assigned("Tighten to 1.76 N·m [2].")).toEqual({ "2": ["1.76 N·m"] }));
  it("after (leading citation)", () => expect(assigned("[2] gives 1.76 N·m.")).toEqual({ "2": ["1.76 N·m"] }));
  it("marker after the full stop binds backward (1 and 2 spaces)", () => {
    expect(assigned("Tighten to 1.76 N·m. [2] Then check the fuses.")).toEqual({ "2": ["1.76 N·m"] });
    expect(assigned("Tighten to 1.76 N·m.  [2] Then go.")).toEqual({ "2": ["1.76 N·m"] });
  });
  it("marker at the very start of the answer", () => expect(assigned("[1] 1.5 kW is the rating.")).toEqual({ "1": ["1.5 kW"] }));
  it("both sides: the cited value is never dropped and is what the quote shows", () => {
    const a = "At 60 Hz, the rated output for [2] is 1.5 kW.";
    expect(assigned(a)["2"]).toContain("1.5 kW");
    const far = ["Supply 60 Hz only. " + "x".repeat(400) + " Rated output 1.5 kW for this frame."];
    const r = supportingQuote(far, a, "2", "What is the rated output at 60 Hz?");
    expect(r.quote).toContain("1.5 kW");
    expect(r.support).toBe("partial");
  });
  it("both values in one window ⇒ full support (round-4 reviewer case)", () => {
    const chunk =
      "Nameplate data: input frequency 60 Hz, line voltage 480 V. " +
      "Output rating table: Frame A rated output 1.5 kW continuous duty at 40°C ambient.";
    const r = supportingQuote([chunk], "At 60 Hz, the rated output for [2] is 1.5 kW.", "2", Q_TORQUE);
    expect(r.support).toBe("claim");
    expect(r.quote).toContain("1.5 kW");
  });
});

describe("multiple values and conflicts — a quote never supports a value the citation did not claim", () => {
  it("two citations in one sentence never share values (trailing and leading styles)", () => {
    expect(assigned("Frames A–D take 1.76 N·m [1], frame E takes 3.09 N·m [2].")).toEqual({ "1": ["1.76 N·m"], "2": ["3.09 N·m"] });
    expect(assigned("[1] says 1.76 N·m while [2] says 3.09 N·m.")).toEqual({ "1": ["1.76 N·m"], "2": ["3.09 N·m"] });
  });
  it("[1]'s page also holds [2]'s value: [1] is quoted on its own value", () => {
    const page = ["Frame E 3.09 N•m is listed first here. " + "y".repeat(300) + " Frames A–D 1.76 N•m apply."];
    const r = supportingQuote(page, "Frames A–D take 1.76 N·m [1], frame E takes 3.09 N·m [2].", "1", "torque");
    expect(r.quote).toContain("1.76 N•m");
    expect(r.quote).not.toContain("3.09");
  });
  it("conflicting value (answer 2.0, source 1.76…2.16) is never shown as support", () => {
    const r = supportingQuote([VALUE_CHUNK], "Tighten to 2.0 N·m [2].", "2", Q_TORQUE);
    expect(r).toEqual({ quote: null, support: "question_fallback", unsupported: ["2.0 N·m"] });
  });
  it("a value inside a source range but not an endpoint is unsupported", () => {
    expect(supportingQuote([VALUE_CHUNK], "Use 1.9 N·m [2].", "2", Q_TORQUE).unsupported).toEqual(["1.9 N·m"]);
  });
  it("condition in the source, cited value absent ⇒ not 'claim', value reported", () => {
    const r = supportingQuote(["Ambient test condition: measured at 50°C per the standard."], "At 50°C, the rated current for [2] is 12 A.", "2", Q_TORQUE);
    expect(r.support).not.toBe("claim");
    expect(r.unsupported).toContain("12 A");
  });
  it("range endpoints scattered across unrelated rows (unitless) ⇒ not 'claim'", () => {
    const chunk = "Fault table row: code 1.76 reported once. Separate spec: upper limit is 2.16 for a different param.";
    expect(supportingQuote([chunk], "The torque range is 1.76 to 2.16 N·m [2].", "2", Q_TORQUE).support).not.toBe("claim");
  });
  it("one marker with a comma list: never a false 'claim' when the source holds only one", () => {
    const r = supportingQuote(["Setpoint 30 rpm only."], "Values 10, 20, 30 [1] 40, 50, 60.", "1", "setpoints");
    expect(r.support).not.toBe("claim");
  });
  it("same citation used twice unions its values; [10] is not [1]; adjacent [1][2] share", () => {
    expect(assigned("Frame A uses 1.76 N·m [1]. Frame E uses 3.09 N·m [1].")).toEqual({ "1": ["1.76 N·m", "3.09 N·m"] });
    expect(assigned("Value 1.76 N·m [10].")).toEqual({ "10": ["1.76 N·m"] });
    expect(assigned("Torque 1.76 N·m [1][2].")).toEqual({ "1": ["1.76 N·m"], "2": ["1.76 N·m"] });
  });
});

describe("units", () => {
  it("525 V is a claim value even when the question names PowerFlex 525", () =>
    expect(assigned("The drive is rated 525 V [2].", "What voltage is the PowerFlex 525 rated for?")).toEqual({ "2": ["525 V"] }));
  it("the unit must match: a '525' model heading never supports '525 V'", () => {
    const r = supportingQuote(["PowerFlex 525 Adjustable Frequency AC Drive. Supply 480 V three phase."], "The drive is rated 525 V [2].", "2", "What voltage is the PowerFlex 525 rated for?");
    expect(r).toEqual({ quote: null, support: "question_fallback", unsupported: ["525 V"] });
  });
  it("same number with a different unit elsewhere is not support", () => {
    const r = supportingQuote(["Insulation test: 1.76 V leakage observed. Elsewhere: torque spec 1.76 N·m is correct."], "Tighten to 1.76 N·m [2].", "2", Q_TORQUE);
    expect(r.support).toBe("claim");
    expect(r.quote).toContain("1.76 N·m");
  });
  it("'525-series' is identity, '1.5 kW' is a claim", () =>
    expect(assigned("A 525-series drive rated 1.5 kW [2].")).toEqual({ "2": ["1.5 kW"] }));
  it("N·m, N•m, Nm and N-m are one unit", () => {
    for (const u of ["N·m", "N•m", "Nm", "N-m"])
      expect(supportingQuote([`Torque 1.76 ${u} on frame A.`], "Use 1.76 N·m [1].", "1", "torque").support).toBe("claim");
  });
  it("bold, ≈ and ~ around the value still match", () => {
    expect(supportingQuote(["Torque: 1.76-2.16 N·m per screw."], "Tighten to **1.76-2.16 N·m** [2].", "2", Q_TORQUE).support).toBe("claim");
    expect(supportingQuote(["Torque: 1.76 N·m typical."], "Tighten to ≈1.76 N·m [2].", "2", Q_TORQUE).support).toBe("claim");
  });
  it("a footnote (1) and a page reference are not claim values", () =>
    expect(assigned("F004 (1) is UnderVoltage, see page 12 [1].")).toEqual({}));
});

describe("comma decimals (round-4 HIGH)", () => {
  it("'1,76 N·m' in the answer is 1.76, not 76", () =>
    expect(assigned("Tighten to 1,76 N·m [2].")).toEqual({ "2": ["1,76 N·m"] }));
  it("a European-format source supports a dot-decimal answer", () => {
    const r = supportingQuote(["Torque: 1,76 N·m per screw (European manual)."], "Tighten to 1.76 N·m [2].", "2", Q_TORQUE);
    expect(r.support).toBe("claim");
  });
  it("'1,000 V' is one thousand, and '10,20,30' is a list, not a decimal", () => {
    expect(assignValues("Rated 1,000 V [1].", "").get("1")?.[0].nums).toEqual([1000]);
    expect(assignValues("Setpoints 10,20,30 rpm [1].", "").get("1")?.map((v) => v.nums[0])).toEqual([10, 20, 30]);
  });
  it("comma decimal is never matched to a different number (1,76 vs 76)", () => {
    const r = supportingQuote(["Max 76 N·m on the large frame."], "Tighten to 1,76 N·m [2].", "2", Q_TORQUE);
    expect(r.support).toBe("question_fallback");
  });
});

describe("table layouts — the complete row is the claim", () => {
  it("citation in its own column", () => {
    const a = "| Frame | Torque | Source |\n|---|---|---|\n| A | 1.76…2.16 N·m | [2] |";
    expect(assigned(a)).toEqual({ "2": ["1.76…2.16 N·m"] });
    const r = supportingQuote([FUSES_CHUNK, VALUE_CHUNK], a, "2", Q_TORQUE);
    expect(r.quote).toContain("1.76…2.16 N•m");
    expect(r.support).toBe("claim");
  });
  it("one row per frame, own markers; ref column with [2]/[3]; multi-marker row; aligned header", () => {
    expect(assigned("| A–D | 1.76 N·m [1] |\n| E | 3.09 N·m [2] |")).toEqual({ "1": ["1.76 N·m"], "2": ["3.09 N·m"] });
    expect(assigned("| Frame | Torque | Ref |\n|---|---|---|\n| A-D | 1.76-2.16 N·m | [2] |\n| E | 3.09 N·m | [3] |")).toEqual({ "2": ["1.76-2.16 N·m"], "3": ["3.09 N·m"] });
    expect(assigned("| Frame | Torque | Ref |\n|:---|:---:|---:|\n| A-D | 1.76-2.16 N·m | [1][2] |")).toEqual({ "1": ["1.76-2.16 N·m"], "2": ["1.76-2.16 N·m"] });
  });
  it("a first-row marker cannot reach the header or a previous row; list items are separate", () => {
    expect(assigned("| Frame | 9.99 N·m header-ish |\n|---|---|\n| E | 3.09 N·m | [2] |")).toEqual({ "2": ["3.09 N·m"] });
    expect(assigned("- Frames A–D: 1.76 N·m [1]\n- Frame E: 3.09 N·m [2]")).toEqual({ "1": ["1.76 N·m"], "2": ["3.09 N·m"] });
  });
});

describe("invariants", () => {
  it("values only past the model-visible 1200 chars are never quoted", () => {
    const long = "z".repeat(MODEL_VISIBLE_CHARS + 50) + " Torque 7.77 N•m.";
    expect(supportingQuote([long], "Use 7.77 N·m [1].", "1", "torque")).toEqual({ quote: null, support: "question_fallback", unsupported: ["7.77 N·m"] });
  });
});

describe("withSupportingQuotes (the route seam)", () => {
  const url = "/files/520-pc001.pdf";
  const chunks = [
    { content: "Page two text. Fault table F004 UnderVoltage.", sourceUrl: url, sourcePage: 2 },
    { content: FUSES_CHUNK, sourceUrl: url, sourcePage: 1 },
    { content: VALUE_CHUNK, sourceUrl: url, sourcePage: 1 },
  ];
  it("numbers pages like buildCitations ([1]=p.2, [2]=p.1) and fixes [2]'s quote", () => {
    const original = relevantQuoteWindow(FUSES_CHUNK, Q_TORQUE); // what buildCitations stored
    const r = withSupportingQuotes([{ citationId: "2", quote: original, docId: "d" }], chunks, REAL_ANSWER, Q_TORQUE);
    expect(original).not.toContain("1.76");
    expect(r.citations[0].quote).toContain("1.76…2.16 N•m");
    expect(r.citations[0].docId).toBe("d");
    expect(r.unsupportedValueCount).toBe(0);
  });
  it("no claimed values ⇒ the citation object is returned unchanged (byte-identical quote)", () => {
    const c = { citationId: "1", quote: relevantQuoteWindow(chunks[0].content, "What does fault F004 mean") };
    const r = withSupportingQuotes([c], chunks, "F004 indicates UnderVoltage [1].", "What does fault F004 mean");
    expect(r.citations[0]).toBe(c);
    expect(r.quoteFallbackCount).toBe(1);
  });
  it("counts unsupported claimed values for the observe-only anomaly", () => {
    const r = withSupportingQuotes([{ citationId: "2", quote: "q" }], chunks, "Tighten to 2.0 N·m [2].", Q_TORQUE);
    expect(r.citations[0].quote).toBe("q");
    expect(r.unsupportedValueCount).toBe(1);
  });
});

describe("Codex round 1 (PR #4319) — a sign, an AC/DC qualifier or inline markup never makes a false 'claim'", () => {
  it("F1: -20 °C never matches +20 °C, in either direction", () => {
    expect(supportingQuote(["Temperature allowed 20 °C."], "Minimum temperature is -20 °C [1].", "1", "")).toEqual({ quote: null, support: "question_fallback", unsupported: ["-20 °C"] });
    expect(supportingQuote(["Minimum ambient -20 °C."], "The limit is 20 °C [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Minimum ambient −20 °C."], "Minimum temperature is -20 °C [1].", "1", "").support).toBe("claim"); // U+2212 minus
  });
  it("F1: a signed range keeps both endpoint signs; an ordinary range is unaffected", () => {
    expect(assignValues("Operating range -20 to -10 °C [1].", "").get("1")?.[0].nums).toEqual([-20, -10]);
    expect(assignValues("Torque 1.76-2.16 N·m [1].", "").get("1")?.[0].nums).toEqual([1.76, 2.16]);
    expect(supportingQuote(["Storage -20…-10 °C."], "Store at -20 to -10 °C [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Storage 20…10 °C."], "Store at -20 to -10 °C [1].", "1", "").support).toBe("question_fallback");
  });
  it("F2: VAC and VDC are contradictory; spaced and compact spellings agree; bare V is compatible", () => {
    expect(supportingQuote(["Input rating 24 VAC."], "Input rating is 24 VDC [1].", "1", "")).toEqual({ quote: null, support: "question_fallback", unsupported: ["24 VDC"] });
    expect(supportingQuote(["Input rating 24 V DC."], "Input rating is 24 VAC [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Input rating 24 V DC."], "Input rating is 24 VDC [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Input rating 24 Vdc."], "Input rating is 24 V DC [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Input rating 24 VDC."], "Input rating is 24 V [1].", "1", "").support).toBe("claim");
  });
  it("F3: inline markup around the number never strips its unit", () => {
    for (const a of ["Rated current is **12** A [1].", "Rated current is *12* A [1].", "Rated current is `12` A [1].", "Rated current is __12__ A [1]."]) {
      expect(supportingQuote(["Leakage test 12 V only."], a, "1", "current")).toEqual({ quote: null, support: "question_fallback", unsupported: [expect.stringContaining("12")] });
      expect(supportingQuote(["Rated current 12 A continuous."], a, "1", "current").support).toBe("claim");
    }
  });
});

describe("Codex round 2 (PR #4319) — a parse can never loosen a claim into a wildcard", () => {
  const fallbackWith = (unsupported: string) => ({ quote: null, support: "question_fallback", unsupported: [expect.stringContaining(unsupported)] });
  it("F1: a minus separated by markup or a space is still a minus — opposite signs never match, equal ones do", () => {
    expect(supportingQuote(["Ambient allowed 20 °C."], "Minimum is -**20** °C [1].", "1", "")).toEqual(fallbackWith("20"));
    expect(supportingQuote(["Minimum ambient -20 °C."], "Minimum is -**20** °C [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Ambient allowed 20 °C."], "Minimum is - 20 °C [1].", "1", "")).toEqual(fallbackWith("20"));
    expect(supportingQuote(["Minimum ambient -20 °C."], "Minimum is - 20 °C [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Minimum ambient − 20 °C."], "The limit is 20 °C [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Minimum ambient − 20 °C."], "The limit is -20 °C [1].", "1", "").support).toBe("claim");
  });
  it("F1: a list bullet is not a sign, and a letter-hyphen code (A-20) is not a value", () => {
    expect(assignValues("- 20 V supply [1]", "").get("1")?.[0].nums).toEqual([20]);
    expect(assignValues("Use the A-20 model [1].", "").get("1")).toBeUndefined();
  });
  it("F4: an explicit unit is never dropped — kV and cm are not V", () => {
    expect(supportingQuote(["Voltage 12 V only."], "Voltage is 12 kV [1].", "1", "")).toEqual(fallbackWith("12 kV"));
    expect(supportingQuote(["Width 12 V and 12 mm."], "The gap is 12 cm [1].", "1", "")).toEqual(fallbackWith("12 cm"));
    expect(supportingQuote(["Supply 12 kV three phase."], "Voltage is 12 kV [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Gap 12 cm nominal."], "The gap is 12 cm [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Ramp time 12 s."], "The ramp takes 12 seconds [1].", "1", "").support).toBe("claim");
  });
  // Design rev 5 reverses the last line deliberately: a unitless value is never usable.
  it("F4: a unitless claim is never a wildcard — and, since rev 5, never support at all", () => {
    expect(supportingQuote(["Supply 12 V only."], "The limit is 12 [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Limit 12 boxes per shift."], "The limit is 12 [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Row count is 12."], "The limit is 12 [1].", "1", "").support).toBe("question_fallback");
  });
  it("F4: the machine's model number stays excluded even when a word follows it", () => {
    expect(assignValues("The PowerFlex 525 drive is rated 1.5 kW [1].", "Is the PowerFlex 525 rated 1.5 kW?").get("1")?.map((v) => v.text.trim())).toEqual(["1.5 kW"]);
  });
});

describe("same class, found before round 3 — fractions and tolerances are never read as plain values", () => {
  // Round 4 (option A): a fraction is a quantity the parser cannot consume, so it is a claim
  // that can never be supported — counted unsupported, never matched, never silently dropped.
  it("a fraction's parts are not values: '1/2 in' never matches '2 in', and the claim is counted", () => {
    expect(supportingQuote(["Use a 2 in pipe."], "Use a 1/2 in wrench [1].", "1", "")).toEqual({ quote: null, support: "question_fallback", unsupported: ["1"] });
    expect(assignValues("Rated 12/24 V dual [1].", "").get("1")?.map((v) => [v.text, v.complete])).toEqual([["12", false]]);
  });
  it("a ± tolerance only matches a ± tolerance", () => {
    expect(supportingQuote(["Shaft length 0.5 mm."], "Runout is ±0.5 mm [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Runout ±0.5 mm max."], "Runout is ±0.5 mm [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Runout ±0.5 mm max."], "Length is 0.5 mm [1].", "1", "").support).toBe("question_fallback");
  });
});

describe("Codex round 3 (PR #4319) — a value counts only when the parser consumes the whole quantity", () => {
  const fallback = (...unsupported: string[]) => ({ quote: null, support: "question_fallback", unsupported });

  it("F1: a line-leading Unicode minus (U+2212) is a sign, never a list bullet", () => {
    expect(supportingQuote(["− 20 °C minimum."], "The limit is 20 °C [1].", "1", "")).toEqual(fallback("20 °C"));
    expect(supportingQuote(["− 20 °C minimum."], "The limit is -20 °C [1].", "1", "").support).toBe("claim");
  });
  it("F1: a minus separated from its number by markup at the start of an answer line is a sign", () => {
    expect(supportingQuote(["Allowed 20 °C."], "-**20** °C [1] is the minimum.", "1", "")).toEqual(fallback("-**20** °C"));
    expect(supportingQuote(["Minimum -20 °C."], "-**20** °C [1] is the minimum.", "1", "").support).toBe("claim");
  });
  it("F1: only a Markdown list marker at the start of an answer line is a bullet; in source text a spaced line-leading sign is ambiguous", () => {
    expect(supportingQuote(["Supply 20 V."], "- 20 V supply [1]", "1", "").support).toBe("claim"); // a real bullet
    expect(supportingQuote(["Allowed 20 °C."], "The range is fine. - 20 °C is the minimum [1].", "1", "")).toEqual(fallback("- 20 °C"));
    expect(supportingQuote(["- 20 °C minimum."], "The limit is 20 °C [1].", "1", "")).toEqual(fallback("20 °C"));
    expect(supportingQuote(["- 20 °C minimum."], "The limit is -20 °C [1].", "1", "")).toEqual(fallback("-20 °C"));
  });
  it("F5: a compound unit is never truncated into a match, in either direction", () => {
    expect(supportingQuote(["Current 12 A."], "Current density is 12 A/mm² [1].", "1", "")).toEqual(fallback("12 A"));
    expect(supportingQuote(["Current density 12 A/mm²."], "Current is 12 A [1].", "1", "")).toEqual(fallback("12 A"));
    expect(supportingQuote(["Speed 12 m/s."], "Acceleration is 12 m/s² [1].", "1", "")).toEqual(fallback("12 m"));
  });
  it("F5: an AC/DC/rms/peak qualifier after any unit spelling makes the value unusable", () => {
    expect(supportingQuote(["Rating 12 volts AC."], "Rating is 12 volts DC [1].", "1", "")).toEqual(fallback("12 volts"));
    expect(supportingQuote(["Ripple 12 V peak."], "Ripple is 12 V rms [1].", "1", "")).toEqual(fallback("12 V"));
    expect(supportingQuote(["Supply 12 V-AC."], "Supply is 12 V-DC [1].", "1", "")).toEqual(fallback("12 V"));
    expect(supportingQuote(["Supply 12 V."], "Supply is 12 V (AC) [1].", "1", "")).toEqual(fallback("12 V"));
  });
  // Each source holds exactly the prefix the parser would match without the rule, so only the
  // completeness rule stands between the pair and a false 'claim'.
  it("completeness: a trailing /, ^, superscript, ·, joined word or .digit makes a value unusable", () => {
    expect(supportingQuote(["Supply 12 V only."], "Rated 12 V/24 V [1].", "1", "")).toEqual(fallback("12 V"));
    expect(supportingQuote(["Area 12 m."], "Area is 12 m^2 [1].", "1", "")).toEqual(fallback("12 m"));
    expect(supportingQuote(["Speed 102 rpm."], "Speed is 10² rpm [1].", "1", "")).toEqual(fallback("10"));
    expect(supportingQuote(["Count is 10 only."], "Speed is 10² rpm [1].", "1", "")).toEqual(fallback("10"));
    expect(supportingQuote(["Volume 12 m nominal."], "Volume is 12 m³ [1].", "1", "")).toEqual(fallback("12 m"));
    expect(supportingQuote(["Power 12 kW."], "Energy is 12 kW·h [1].", "1", "")).toEqual(fallback("12 kW"));
    expect(supportingQuote(["Supply 400 V."], "Use a 400 V-class drive [1].", "1", "")).toEqual(fallback("400 V"));
    expect(supportingQuote(["Supply 10 V."], "The range is 10 V-20 V [1].", "1", "")).toEqual(fallback("10 V"));
    expect(supportingQuote(["Firmware 1.2.0 required."], "Firmware 1.2.3 is required [1].", "1", "")).toEqual(fallback("1.2"));
  });
  it("a comparator is part of the value, like ±", () => {
    expect(supportingQuote(["Ambient <40 °C."], "Ambient must be >40 °C [1].", "1", "")).toEqual(fallback(">40 °C"));
    expect(supportingQuote(["Max ambient 40 °C."], "Ambient must be ≤40 °C [1].", "1", "")).toEqual(fallback("≤40 °C"));
    expect(supportingQuote(["Ambient ≤ 40 °C."], "Ambient must be <= 40 °C [1].", "1", "").support).toBe("claim");
  });
  it("controls: fully consumed quantities still match", () => {
    expect(supportingQuote(["Rated current 12 A continuous."], "Rated current is 12 A [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Wire 5.3 mm2 (10 AWG)."], "Use 5.3 mm² wire [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Input 24 V AC."], "Input is 24 VAC [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Ripple 12 Vrms."], "Ripple is 12 Vrms [1].", "1", "").support).toBe("claim");
  });
  it("the cost, stated: an identical but unconsumable quantity is not matched either", () =>
    expect(supportingQuote(["Speed 12 m/s."], "Speed is 12 m/s [1].", "1", "")).toEqual(fallback("12 m")));
  it("the route seam counts an unconsumable claim and keeps the existing quote", () => {
    const r = withSupportingQuotes([{ citationId: "1", quote: "q" }], [{ content: "Current 12 A.", sourceUrl: "/m.pdf", sourcePage: 1 }], "Current density is 12 A/mm² [1].", "");
    expect(r.citations[0].quote).toBe("q");
    expect(r.unsupportedValueCount).toBe(1);
  });
});

describe("Codex round 4 (PR #4319) + design rev 5 — a value is usable only when every part of it is recognized", () => {
  const fallback = (...unsupported: string[]) => ({ quote: null, support: "question_fallback", unsupported });

  it("F6: unit symbols keep their case — milli is never mega, in either direction", () => {
    expect(supportingQuote(["Power 12 mW."], "Power is 12 MW [1].", "1", "")).toEqual(fallback("12 MW"));
    expect(supportingQuote(["Power 12 MW."], "Power is 12 mW [1].", "1", "")).toEqual(fallback("12 mW"));
    expect(supportingQuote(["Resistance 12 mΩ."], "Insulation resistance is 12 MΩ [1].", "1", "")).toEqual(fallback("12 MΩ"));
    expect(supportingQuote(["Resistance 12 MΩ."], "Contact resistance is 12 mΩ [1].", "1", "")).toEqual(fallback("12 mΩ"));
    expect(supportingQuote(["Rated 12 MW output."], "Power is 12 MW [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Insulation 12 MΩ minimum."], "Insulation resistance is 12 MΩ [1].", "1", "").support).toBe("claim");
  });
  it("F6: N·m is never nm, and a unit outside the table is unusable rather than matching itself", () => {
    expect(supportingQuote(["Wavelength 12 nm."], "Tighten to 12 N·m [1].", "1", "")).toEqual(fallback("12 N·m"));
    expect(supportingQuote(["Pitch 12 furlongs."], "Pitch is 12 furlongs [1].", "1", "")).toEqual(fallback("12 furlongs"));
  });
  it("F7: a space-grouped number is never read as its trailing group, in either direction", () => {
    for (const sep of [" ", " ", " "]) {
      expect(supportingQuote(["Output 0 V."], `Rated 1${sep}000 V [1].`, "1", "")).toEqual(fallback("1", "000 V"));
      expect(supportingQuote([`Rated 1${sep}000 V.`], "Output is 0 V [1].", "1", "")).toEqual(fallback("0 V"));
    }
  });
  it("F5: a second unit after a space continues the quantity, in either direction", () => {
    expect(supportingQuote(["Power 12 kW."], "Energy is 12 kW h [1].", "1", "")).toEqual(fallback("12 kW"));
    expect(supportingQuote(["Energy 12 kW h."], "Power is 12 kW [1].", "1", "")).toEqual(fallback("12 kW"));
    expect(supportingQuote(["Length 12 m."], "Speed is 12 m s⁻¹ [1].", "1", "")).toEqual(fallback("12 m"));
    expect(supportingQuote(["Speed 12 m s⁻¹."], "Length is 12 m [1].", "1", "")).toEqual(fallback("12 m"));
  });
  it("rev 5: a unitless value is never usable, so a shared trailing unit can't be read away", () => {
    expect(supportingQuote(["Count is 12 only."], "Use 12 or 24 V [1].", "1", "")).toEqual(fallback("12", "24 V"));
    const r = supportingQuote(["Supply 24 V only."], "Use between 12 and 24 V [1].", "1", "");
    expect(r.support).toBe("partial");
    expect(r.unsupported).toEqual(["12"]);
    expect(r.quote).toContain("24 V");
  });
  it("rev 5 controls: prose after a unit, a line that ends on a unit, and case or character variants of one unit", () => {
    expect(supportingQuote(["Torque 12 N·m\n3. Next step"], "Tighten to 12 N·m [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Supply 24 V in the cabinet."], "Supply is 24 V [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Output 2.2 KW continuous."], "Output is 2.2 kW [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Ripple at 50 hz."], "Ripple is at 50 Hz [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Pulse 12 μs wide."], "The pulse is 12 µs [1].", "1", "").support).toBe("claim"); // U+03BC vs U+00B5
    expect(supportingQuote(["Max 40 ℃."], "The maximum is 40 °C [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Resistance 12 Ω."], "Resistance is 12 Ω [1].", "1", "").support).toBe("claim"); // OHM SIGN vs Greek Omega
  });
  it("rev 5 (found pre-review): a ± tolerance after a value continues the quantity, in either direction", () => {
    expect(supportingQuote(["Supply 12 V nominal."], "Supply is 12 V ±5% [1].", "1", "").support).toBe("question_fallback");
    expect(supportingQuote(["Supply 12 V ± 5%."], "Supply is 12 V [1].", "1", "")).toEqual(fallback("12 V"));
  });
  it("rev 5 (found pre-review): a single 3-digit group (1,000 / 1.000) is locale-ambiguous and matches only the same literal", () => {
    expect(supportingQuote(["Max 1.000 V."], "Max is 1 V [1].", "1", "")).toEqual(fallback("1 V"));
    expect(supportingQuote(["Max 1,000 V."], "Max is 1000 V [1].", "1", "")).toEqual(fallback("1000 V"));
    expect(supportingQuote(["Speed 1,500 rpm."], "Speed is 1,500 rpm [1].", "1", "").support).toBe("claim");
    expect(supportingQuote(["Speed 1,500,000 rpm."], "Speed is 1500000 rpm [1].", "1", "").support).toBe("claim"); // two groups: unambiguous
  });
  it("rev 5 (found pre-review): AC/DC marks written as symbols or with dots continue the quantity", () => {
    expect(supportingQuote(["Supply 230 V~."], "Supply is 230 VDC [1].", "1", "")).toEqual(fallback("230 VDC"));
    expect(supportingQuote(["Supply 24 V=."], "Supply is 24 VAC [1].", "1", "")).toEqual(fallback("24 VAC"));
    expect(supportingQuote(["Supply 12 V d.c."], "Supply is 12 V a.c. [1].", "1", "")).toEqual(fallback("12 V"));
    expect(supportingQuote(["Supply 12 V."], "Supply is 12 V₁ [1].", "1", "")).toEqual(fallback("12 V")); // a subscript extends the unit
  });
  it("rev 5 (found pre-review): every Unicode space separates digit groups, not only NBSP", () => {
    for (const sep of [" ", "　", " "])
      expect(supportingQuote(["Output 0 V."], `Rated 1${sep}000 V [1].`, "1", "")).toEqual(fallback("1", "000 V"));
  });
  it("the route seam counts every unusable piece of a space-grouped claim", () => {
    const r = withSupportingQuotes([{ citationId: "1", quote: "q" }], [{ content: "Output 0 V.", sourceUrl: "/m.pdf", sourcePage: 1 }], "Rated 1 000 V [1].", "");
    expect(r.citations[0].quote).toBe("q");
    expect(r.unsupportedValueCount).toBe(2);
  });
});
