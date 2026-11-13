// #5466 — an answer drawn from a contact-ratings table must keep its columns apart.
//
// Pure-function tests for rating-column.ts. The route-level proof (the draft is
// withheld before a byte of it is released) is rating-column.route.test.ts.
//
// Run: npx vitest run src/capabilities/__tests__/rating-column.test.ts
import { describe, expect, it } from "vitest";
import { validateAnswer } from "../answer-validation";
import { ratingColumnFinding, ratingColumnText, ratingRowAmperes, type RatingPassage } from "../rating-column";
import { contactRatingColumns, readColumnLines, withColumnLines } from "../contact-ratings-table";
import type { LayoutItem } from "../pdf-layout-items";
import p19Items from "../__fixtures__/contact-ratings/micro820-in009b-p19.json";

// Page 19 of Rockwell 2080-IN009B-EN-P (April 2014), as the hub's PDF text
// extraction returns it: the table's column heads are flattened out of order.
const P19 =
  "Micro820 20-Point Programmable Controllers 19\nPublication 2080-IN009B-EN-P - April 2014\nRelay Contact Ratings\nMaximum\nVolts Amperes Amperes\n"
  + "Continuous Volt-Amperes\nMake Break Make Break\n120 V AC 15 A 1.5 A 2 A 1800 180\n240 V AC 7.5 A 0.75 A\n24 V DC 1.0 A 1 A 28\n125 V DC 0.22 A\n"
  + "Analog Output Specifications\nAttribute Value\nOutput count range 0...4008\nOutput type Voltage\nOutput Voltage Range 0…10V\n"
  + "Voltage Output Maximum Load (Resistive) >1000 Ohms";
// Page 12 of the same sheet: prose about surge suppression, no table.
const P12 =
  "Switching inductive loads without surge suppression can significantly reduce the life expectancy of relay contacts. "
  + "By adding a suppression device directly across the coil of an inductive device, you prolong the life of the output or relay contacts.";
// The same page as an upload at extraction version 4 stores it (#5474 item 5): the flat text,
// with the column of each figure read from the page's own text positions written under the table.
const P19_STORED = withColumnLines(P19, contactRatingColumns(p19Items.items as LayoutItem[])!);
const prose = (cited: boolean): RatingPassage => ({ content: P12, title: "2080-IN009B-EN-P.pdf", page: 12, cited });

const LOAD_QUESTION = "Can I switch a 5 A, 120 V AC motor contactor coil load directly from a Micro820 relay output?";
const RATING_QUESTION = "What is the relay output rated for at 120 V AC?";
// The answer served on staging 6da4ab674, 2026-11-13 (trace 3b78d674…).
const SERVED =
  "Yes—the Micro820 relay output is rated for 15 A at 120 V AC, but inductive loads like motor starters and solenoids "
  + "should have surge suppression across the coil to protect the contacts [2][1]. Without suppression, switching inductive "
  + "loads can significantly reduce relay contact life [1].";
const NAMED =
  "No. At 120 V AC the relay contacts are rated 15 A make, 1.5 A break and 2 A continuous [2], so a 5 A coil load is over the continuous rating.";

it("the stored page is the flat page plus four column lines", () => {
  expect(P19_STORED.split("\n").length).toBe(P19.split("\n").length + 4);
  expect(P19_STORED).toContain("120 V AC row: make 15 A, break 1.5 A, continuous 2 A.");
});

// Every expectation written for #5466 holds for a page stored either way: the column lines add
// the WRONG-COLUMN rule (its own block, below) and change nothing else.
describe.each([
  ["page stored as flat text", P19],
  ["page stored with its column lines", P19_STORED],
])("%s", (_stored, PAGE) => {
const table = (cited: boolean): RatingPassage => ({ content: PAGE, title: "2080-IN009B-EN-P.pdf", page: 19, cited });
const CITED = [prose(true), table(true)];

describe("what reads as a contact-ratings table", () => {
  it("reads the ampere figures on the rating rows of the real page", () => {
    expect(ratingRowAmperes(PAGE).sort((a, b) => a - b)).toEqual([0.22, 0.75, 1, 1.5, 2, 7.5, 15]);
  });
  it("does not read volt-amperes or volts as ampere figures", () => {
    expect(ratingRowAmperes(P19)).not.toContain(1800);
    expect(ratingRowAmperes(P19)).not.toContain(120);
  });
  it("a page with no make/break/continuous heads is not one", () => {
    expect(ratingRowAmperes(P12)).toEqual([]);
    expect(ratingRowAmperes("I/O rating Input: 120V AC 16 mA\nOutput: 2 A, 240 V AC\n2A, 24V DC")).toEqual([]);
  });
  it("prose that happens to use the three words is not one", () => {
    expect(ratingRowAmperes("Make sure the drive is off. Do not break the seal. Continuous duty: 10 A in, 8 A out.")).toEqual([]);
  });
});

describe("LOAD rule — the asked load is over a figure on the row, and the answer does not show that figure", () => {
  it("the served answer is caught, with the row and the lower figures as the page writes them", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, SERVED, CITED)).toEqual({
      rule: "load", title: "2080-IN009B-EN-P.pdf", page: 19, load: "5 A", row: "120 V AC", lower: ["1.5 A", "2 A"],
    });
  });
  // Wordings an independent review got past a words-only check (2026-11-13).
  it.each([
    "Yes, the output can carry 5 A and is rated 15 A at 120 V AC [2].",
    "Yes, the output can run continuously at 15 A at 120 V AC [2].",
    "Yes. Make sure the coil is on the output; the output is rated 15 A at 120 V AC [2].",
    "Yes, just break the coil circuit, since the output is rated 15 A at 120 V AC [2].",
    "Yes, the make rating of 15 A covers it [2].",
    "Yes, it can be switched directly [2].",
    "The output is rated 15 AMPS at 120 V AC [2].",
    "The output is rated 15-A at 120 V AC [2].",
  ])("whatever words it uses: %s", (answer) => {
    expect(ratingColumnFinding(LOAD_QUESTION, answer, CITED)).toMatchObject({ rule: "load", lower: ["1.5 A", "2 A"] });
  });
  it("when the draft drops its citation markers: the table was given, and a figure from it is quoted", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, "Yes, the output is rated 15 A at 120 V AC.", [prose(false), table(false)])).toMatchObject({ rule: "load" });
    expect(ratingColumnFinding(LOAD_QUESTION, "Yes, 15 A at 120 V AC [1].", [prose(true), table(false)])).toMatchObject({ rule: "load" });
  });
  it("reads the row for the asked voltage", () => {
    const q = "Can I switch a 5 A load at 240 V AC from the relay output?";
    expect(ratingColumnFinding(q, "Yes, it is rated 7.5 A at 240 V AC [2].", CITED)).toMatchObject({ rule: "load", row: "240 V AC", lower: ["0.75 A"] });
    expect(ratingColumnFinding(q, "At 240 V AC the row gives 7.5 A and 0.75 A [2]; check which is the make figure and which the break figure.", CITED)).toBeNull();
  });
  it.each(["Can the relay output switch a 5 A load?", "Can the relay output switch a 5 A load at 110 V AC?"])(
    "reads every row when the question names no voltage the table lists, and then shows no figures: %s", (q) => {
      // Figures gathered from every row (AC and DC together) would mislead.
      expect(ratingColumnFinding(q, "It is rated 15 A [2].", CITED)).toEqual({ rule: "load", title: "2080-IN009B-EN-P.pdf", page: 19, load: "5 A", row: null, lower: [] });
      expect(ratingColumnFinding(q, "The table gives 0.22 A at 125 V DC and 15 A make at 120 V AC [2]; use the row for your supply.", CITED)).toBeNull();
    });
  it("reads a voltage written out", () => {
    expect(ratingColumnFinding("Can the relay output switch a 5 A load at 120 volts?", "It is rated 15 A [2].", CITED)).toMatchObject({ row: "120 V AC", lower: ["1.5 A", "2 A"] });
  });
  // The lower figure is in view, but the answer opens by approving a load that is over it.
  it.each([
    "Yes. The relay output is rated 15 A make and 2 A continuous at 120 V AC [2], so a 5 A coil load can be switched.",
    "Yes, the 2 A continuous rating at 120 V AC covers a 5 A coil [2].",
    "You can: 15 A make, 1.5 A break, 2 A continuous [2].",
    "Yes, rated 15 A at 120 V AC. Use a 2 A fuse.",
    // The approval comes second (final safety review, 2026-11-13).
    "The continuous figure on the 120 V AC row is 2 A [2]. Yes, the make rating of 15 A covers it [2].",
    "Continuous is 2 A [2].\nOK, the 15 A make rating is what matters for a coil [2].",
  ])("an answer that shows a lower figure and still has a sentence that opens with an approval: %s", (answer) => {
    expect(ratingColumnFinding(LOAD_QUESTION, answer, [prose(false), table(answer.includes("[2]"))])).toMatchObject({ rule: "load", lower: ["1.5 A", "2 A"] });
  });
  it("a correct refusal that shows no figure is replaced too (stated limit): the replacement shows what it left out", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, "No. Use an interposing relay [2].", CITED)).toMatchObject({ rule: "load", lower: ["1.5 A", "2 A"] });
  });
  it("control: an answer that shows a lower figure passes", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, NAMED, CITED)).toBeNull();
    // "You can" further down is advice, not an approval of the load.
    expect(ratingColumnFinding(LOAD_QUESTION, "No: the continuous rating is 2 A [2]. You can use an interposing relay sized for the coil.", CITED)).toBeNull();
    expect(ratingColumnFinding(LOAD_QUESTION, "No: the continuous rating is 2 A [2].", CITED)).toBeNull();
  });
  // Codex round 1, F1: an inrush figure is judged against make, not break or continuous.
  describe("a question that separates inrush from holding current", () => {
    const COIL = "Can the relay output switch a 120 V AC coil with 10 A inrush and 1 A holding current?";
    const QUALIFIED = "Yes. The 10 A inrush is under the 15 A make rating, and the 1 A holding current is under the 2 A continuous and 1.5 A break ratings at 120 V AC [2].";
    it("a correctly qualified approval is not withheld", () => {
      expect(ratingColumnFinding(COIL, QUALIFIED, CITED)).toBeNull();
    });
    it.each([
      "Can the relay output switch a 120 V AC coil (inrush of 10 A, 1 A sealed)?",
      "Coil draws 1 A holding with a 10 A surge at 120 V AC. Can the relay output switch it?",
    ])("however the question writes it: %s", (q) => {
      expect(ratingColumnFinding(q, QUALIFIED, CITED)).toBeNull();
    });
    it("the holding current is still the load: over a figure on the row, an approval is withheld", () => {
      const q = "Can the relay output switch a 120 V AC coil with 10 A inrush and 3 A holding current?";
      expect(ratingColumnFinding(q, "Yes, 10 A inrush is under the 15 A make rating [2].", CITED)).toMatchObject({ rule: "load", load: "3 A", lower: ["1.5 A", "2 A"] });
    });
    // Codex round 2, F3: the inrush word belongs to ONE figure, and "surge-suppressed" is not a current.
    const MAKE_ONLY = "Yes, the 15 A make rating at 120 V AC covers this coil load [2].";
    it.each([
      ["Can the relay output switch a surge-suppressed 5 A coil at 120 V AC?", "5 A"],
      ["Can the relay output switch a 5 A coil with surge protection at 120 V AC?", "5 A"],
      ["Can the relay output switch a 5 A surge-suppressed coil at 120 V AC?", "5 A"],
      ["Can the relay output switch a 5 A surge protected coil at 120 V AC?", "5 A"],
      ["Can the relay output switch a 120 V AC coil rated 10 A inrush / 5 A holding?", "5 A"],
      ["Can the relay output switch a 120 V AC coil: 10 A inrush, 5 A holding?", "5 A"],
      ["Can the relay output switch a 5 A coil at 120 V AC? Inrush is 10 A.", "5 A"],
      ["The inrush is high. Can the relay output switch a 5 A coil at 120 V AC?", "5 A"],
    ])("only the figure the word sits on is set aside: %s", (q, load) => {
      expect(ratingColumnFinding(q, MAKE_ONLY, CITED)).toMatchObject({ rule: "load", load, lower: ["1.5 A", "2 A"] });
    });
    it.each([
      "Can the relay output switch a 120 V AC coil rated 10 A inrush / 1 A holding?",
      "Can the relay output switch a 120 V AC coil with an inrush current of 10 A and 1 A sealed?",
      "Can the relay output switch a 1 A coil at 120 V AC? Inrush is 10 A.",
      "Can the relay output switch a 120 V AC coil with a 10 A (inrush) and 1 A holding draw?",
    ])("and the qualified approval still passes: %s", (q) => {
      expect(ratingColumnFinding(q, QUALIFIED, CITED)).toBeNull();
    });
    it("a question with only an inrush figure is left to the column rule", () => {
      const q = "Can the relay output take a 10 A inrush at 120 V AC?";
      expect(ratingColumnFinding(q, "Yes: the make rating is 15 A at 120 V AC [2].", CITED)).toBeNull();
      expect(ratingColumnFinding(q, "Yes, it is rated 15 A at 120 V AC [2].", CITED)).toMatchObject({ rule: "column" });
    });
    it("control: the issue's question names no inrush, so its 5 A is the load", () => {
      expect(ratingColumnFinding(LOAD_QUESTION, SERVED, CITED)).toMatchObject({ rule: "load", load: "5 A" });
    });
  });
  it("control: a load under every figure on its row is not this rule's business", () => {
    expect(ratingColumnFinding("Can I switch a 1 A, 120 V AC pilot light from the relay output?", "Yes: 1 A is within the 2 A continuous and 1.5 A break ratings at 120 V AC [2].", CITED)).toBeNull();
  });
  it("control: the table was given but the answer neither cites it nor quotes from it", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, "Add a suppression device across the coil [1].", [prose(true), table(false)])).toBeNull();
  });
  it("control: an uncited table is not read for a question that is not about a relay, contact or output", () => {
    // A fuse or an overload setting that happens to equal a figure in a table the answer never cited.
    const GIVEN = [prose(false), table(false)];
    expect(ratingColumnFinding("The drive draws 7.5 A at 240 V AC. What fuse should I use?", "Use a 7.5 A fuse.", GIVEN)).toBeNull();
    expect(ratingColumnFinding("Which overload setting for a 2 A motor?", "Set the overload to 2 A.", GIVEN)).toBeNull();
  });
  it("control: no ratings table among the passages", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, SERVED, [prose(true)])).toBeNull();
    expect(ratingColumnFinding(LOAD_QUESTION, SERVED, [])).toBeNull();
  });
});

describe("COLUMN rule — a rating-row figure quoted from a cited table names its column", () => {
  it("is caught when no column is named", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The relay output is rated 15 A at 120 V AC [2].", CITED))
      .toEqual({ rule: "column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "15 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "The output handles 2 A at 120 V AC [2].", CITED)).toMatchObject({ rule: "column", figure: "2 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "At 240 V AC it is good for 7.5A [2].", CITED)).toMatchObject({ rule: "column", figure: "7.5A" });
  });
  it.each([
    "At 120 V AC the contacts are rated 15 A make, 1.5 A break and 2 A continuous [2].",
    "The continuous rating at 120 V AC is 2 A [2].",
    "The make (inrush) rating is 15 A at 120 V AC [2].\nThe contact can break 1.5 A [2].",
    "The contacts carry 2 A continuously at 120 V AC [2].",
    "Make:\n- 15 A at 120 V AC [2]\nBreak:\n- 1.5 A at 120 V AC [2]",
    "Relay contact ratings at 120 V AC [2]:\n- Make: 15 A\n- Break: 1.5 A\n- Continuous: 2 A",
    "| Voltage | Make | Break | Continuous |\n|---|---|---|---|\n| 120 V AC | 15 A | 1.5 A | 2 A |\n\nSource: p. 19 [2].",
    "Make / break / continuous at 120 V AC: 15 A / 1.5 A / 2 A [2].",
  ])("passes when the column is named: %s", (answer) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, CITED)).toBeNull();
  });
  it("'carries' names no column", () => {
    expect(ratingColumnFinding("Can I switch that coil directly from the relay output?", "Yes, the output carries 15 A at 120 V AC [2].", CITED)).toMatchObject({ rule: "column", figure: "15 A" });
  });
  it("a heading does not reach across a blank line", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "Make sure the supply is 120 V AC.\n\nThe output is rated 15 A [2].", CITED)).toMatchObject({ rule: "column" });
  });
  it("control: a figure that is not on a rating row", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "A 5 A load needs an interposing relay; see the ratings table [2].", CITED)).toBeNull();
  });
  it("control: the table was given but not cited", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The output is rated 15 A [1].", [prose(true), table(false)])).toBeNull();
  });
  it("control: milliamperes and volts that share digits with a rating row", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The input draws 15 mA at 120 V AC and 2 V drop [2].", CITED)).toBeNull();
  });
  it("control: an answer with no ampere figure", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "Add a suppression device across the coil [1].", CITED)).toBeNull();
  });
});

}); // describe.each: flat text / with column lines

describe("WRONG-COLUMN rule (#5474 item 5) — a figure the page places in a column is not named as another", () => {
  const stored = (cited: boolean): RatingPassage => ({ content: P19_STORED, title: "2080-IN009B-EN-P.pdf", page: 19, cited });
  const flat = (cited: boolean): RatingPassage => ({ content: P19, title: "2080-IN009B-EN-P.pdf", page: 19, cited });
  const GIVEN = [prose(true), stored(true)];
  // The answer served on staging 2199f449a, CV-101 S7, 2026-11-13 20:55Z (trace 9b5adc88…), with its markers.
  const S7_SERVED =
    "No — a 5 A, 120 V AC motor contactor coil exceeds the relay output’s 120 V AC make rating of 1.5 A and break rating of 2 A, "
    + "so it should not be switched directly [2]. For inductive coils, use surge suppression across the coil to protect the output contacts [1].";
  // The answer served for S5 on the same run: correct.
  const S5_SERVED =
    "At 120 V AC, the relay contact ratings are 15 A make, 1.5 A break, 2 A continuous, 1800 VA make, and 180 VA break [2]. "
    + "These apply to the Micro820 relay outputs on the 2080-LC20-20QWB [2].";

  it("the answer served on staging is caught at the figure it misnames", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, S7_SERVED, GIVEN)).toEqual({ rule: "wrong_column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "1.5 A" });
    // Its second wrong assignment, on its own, is caught too.
    expect(ratingColumnFinding(LOAD_QUESTION, "The relay output has a 120 V AC make rating of 15 A and break rating of 2 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
  });
  it("the same answer on a page stored without column lines is not caught (stated limit: reprocess the manual)", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, S7_SERVED, [prose(true), flat(true)])).toBeNull();
  });
  it.each([
    ["the issue's own example", "The contact runs continuously at 15 A at 120 V AC [2].", "15 A"],
    ["word after the figure", "At 120 V AC the contacts are rated 2 A make [2].", "2 A"],
    ["word before the figure", "The break rating at 120 V AC is 15 A [2].", "15 A"],
    ["two figures swapped, word after", "At 120 V AC: 1.5 A make, 15 A break [2].", "1.5 A"],
    ["two figures swapped, word before", "At 120 V AC: break 15 A, make 1.5 A [2].", "15 A"],
    ["all three turned round", "At 120 V AC the ratings are make 1.5 A, break 2 A, continuous 15 A [2].", "1.5 A"],
    ["another row", "At 240 V AC the contacts break 7.5 A [2].", "7.5 A"],
    ["inrush is a make word", "The contact can take an inrush of 2 A at 120 V AC [2].", "2 A"],
    ["under a heading", "Continuous:\n- 15 A at 120 V AC [2]", "15 A"],
  ])("caught: %s", (_name, answer, figure) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toMatchObject({ rule: "wrong_column", figure });
  });
  it("the row is the one the sentence names, before the one the question names", () => {
    // 7.5 A is the make figure at 240 V AC; the question asked about 120 V AC.
    expect(ratingColumnFinding(RATING_QUESTION, "At 240 V AC the continuous rating is 7.5 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "7.5 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "At 240 V AC the make rating is 7.5 A [2].", GIVEN)).toBeNull();
  });
  it("when the draft drops its citation markers: the table was given, and a placed figure is quoted", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The relay output's break rating is 15 A at 120 V AC.", [prose(false), stored(false)])).toMatchObject({ rule: "wrong_column" });
  });
  it.each([
    ["the staging S5 answer", S5_SERVED],
    ["the right columns, word after", NAMED],
    ["the right columns, word before", "At 120 V AC: make 15 A, break 1.5 A, continuous 2 A [2]."],
    ["one figure", "The continuous rating at 120 V AC is 2 A [2]."],
    ["the right word among others", "At 120 V AC the 15 A figure is the make rating, well above the 2 A continuous rating [2]."],
    ["a sentence that says what a figure is not", "At 120 V AC, 15 A is not the continuous rating: it is the make rating, and continuous is 2 A [2]."],
    ["a table with its heads above", "| Voltage | Make | Break | Continuous |\n|---|---|---|---|\n| 120 V AC | 15 A | 1.5 A | 2 A |\n\nSource: p. 19 [2]."],
    ["figures with no column word beside them are the COLUMN rule's, and a list passes it", "Make / break / continuous at 120 V AC: 15 A / 1.5 A / 2 A [2]."],
  ])("control, passes: %s", (_name, answer) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toBeNull();
  });
  it("control: a sentence whose only column word is negated says what the figure is not", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC, 15 A is not the continuous rating [2].", GIVEN)).toBeNull();
    expect(ratingColumnFinding(RATING_QUESTION, "Size the load to 2 A at 120 V AC rather than the break figure [2].", GIVEN)).toBeNull();
  });
  it("one value in different columns on different rows is judged on the row named", () => {
    // A made-up table: 2 A is continuous at 120 V AC and make at 240 V AC.
    const content = withColumnLines("Make Break\nContinuous\n120 V AC 15 A 1.5 A 2 A\n240 V AC 2 A 0.5 A", [
      { label: "120 V AC", make: "15 A", break: "1.5 A", continuous: "2 A", unread: [] },
      { label: "240 V AC", make: "2 A", break: "0.5 A", continuous: null, unread: [] },
    ]);
    const given = [{ content, title: "relay.pdf", page: 3, cited: true }];
    expect(ratingColumnFinding("What is the make rating?", "At 240 V AC the make rating is 2 A [1].", given)).toBeNull();
    expect(ratingColumnFinding("What is the make rating?", "At 120 V AC the make rating is 2 A [1].", given)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
    // The sentence names no voltage: the question's is used.
    expect(ratingColumnFinding("What is the make rating at 120 V AC?", "The make rating is 2 A [1].", given)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
    // Neither names one: every row is read, and 2 A is a make figure on one of them.
    expect(ratingColumnFinding("What is the make rating?", "The make rating is 2 A [1].", given)).toBeNull();
  });
  it("a negated column word excuses only itself: a wrong column named later in the sentence is still judged", () => {
    expect(
      ratingColumnFinding("What is the break rating on 120 V AC?", "The make rating of 15 A is not the continuous rating, and the break rating of 2 A applies [2].", GIVEN),
    ).toMatchObject({ rule: "wrong_column", figure: "2 A" });
  });
  it("surge names the make column", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC the make rating is 15 A and the surge figure is 2 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC the make rating is 1.5 A and the surge figure is 15 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "1.5 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC the break rating is 1.5 A and the surge figure is 15 A [2].", GIVEN)).toBeNull();
  });
  it("control: a figure the page prints in one cell across make and break may be called either (24 V DC, 1.0 A)", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The break rating at 24 V DC is 1 A [2].", GIVEN)).toBeNull();
  });
  it.each([
    // Codex round 1 on #5487: both were withheld by the first version.
    ["a load set against a rating", "What can the relay output carry?", "At 120 V AC, a 1.5 A steady-state load is below the 2 A continuous rating [2]."],
    ["a load that draws a figure", "What can the relay output carry?", "A coil that draws 1.5 A continuously at 120 V AC is under the 2 A continuous rating [2]."],
    ["a rating recommended for another device", "What can the relay output carry?", "At 120 V AC the continuous rating is 2 A [2], so use an interposing relay rated for 15 A continuous."],
  ])("control: %s is not a claim about the table's columns", (_name, question, answer) => {
    expect(ratingColumnFinding(question, answer, GIVEN)).toBeNull();
  });
  it.each([
    // Codex round 2 on #5487: both were withheld.
    ["a load current set against a rating", "At 120 V AC a load current of 1.5 A continuously is below the 2 A continuous rating [2]."],
    ["a warning that the contact cannot do something", "The relay cannot continuously carry 15 A at 120 V AC [2]."],
    ["a warning not to read a figure as a column", "Do not treat 15 A as the continuous rating at 120 V AC [2]."],
    ["a column word near a figure but not on it", "At 120 V AC the output handles 15 A when the contact closes, and the continuous limit is lower [2]."],
  ])("control: %s assigns no figure to a column", (_name, answer) => {
    expect(ratingColumnFinding("What can the relay output carry?", answer, GIVEN)).toBeNull();
  });
  it("an explicit assignment is still withheld", () => {
    expect(ratingColumnFinding("What can the relay output carry?", "At 120 V AC the continuous rating is 15 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "15 A" });
    expect(ratingColumnFinding("What can the relay output carry?", "At 120 V AC 15 A is the continuous rating [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "15 A" });
    expect(ratingColumnFinding("What can the relay output carry?", "The relay cannot break 5 A, and its break rating is 2 A at 120 V AC [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
  });
  it("the sentence's own voltage decides the row, not the question's, also when the rows are in different passages", () => {
    // Codex round 2: 2 A is continuous at 120 V AC and make at 240 V AC; the question asks about 120 V AC.
    const mark = "Contact ratings table (columns read from the page layout), ";
    const one = { content: `${mark}120 V AC row: make 15 A, break 1.5 A, continuous 2 A.`, title: "relay.pdf", page: 3, cited: true };
    const two = { content: `${mark}240 V AC row: make 2 A, break 0.5 A.`, title: "relay.pdf", page: 3, cited: true };
    const whole = { ...one, content: `${one.content}\n${two.content}` };
    for (const given of [[whole], [one, two], [two, one]]) {
      expect(ratingColumnFinding("What is the make rating at 120 V AC?", "At 240 V AC the make rating is 2 A [1].", given)).toBeNull();
      expect(ratingColumnFinding("What is the make rating at 120 V AC?", "At 240 V AC the continuous rating is 2 A [1].", given)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
      expect(ratingColumnFinding("What is the make rating at 120 V AC?", "The make rating is 2 A [1].", given)).toMatchObject({ rule: "wrong_column", figure: "2 A" });
    }
  });
  it.each([
    ["a refusal joined to the claim by because", "It should not be switched directly because the break rating at 120 V AC is 15 A [2].", "15 A"],
    ["a refusal joined to the claim by since", "No, it can't since the make rating is 1.5 A at 120 V AC [2].", "1.5 A"],
    ["only before the figure", "At 120 V AC the make rating is only 1.5 A [2].", "1.5 A"],
    ["about before the figure", "At 120 V AC the make rating is about 1.5 A [2].", "1.5 A"],
    ["up to before the figure", "At 120 V AC the output can break up to 2 A [2].", "2 A"],
    ["bold column word in a bullet", "At 120 V AC:\n- **Break**: 2 A [2]", "2 A"],
    ["bold figure", "At 120 V AC the **break** rating is **2 A** [2].", "2 A"],
    ["two nouns after the column word", "At 120 V AC the continuous current rating is 15 A [2].", "15 A"],
    ["column word after for", "At 120 V AC the rating is 2 A for break [2].", "2 A"],
    ["column word in brackets after", "At 120 V AC the rating is 2 A (break) [2].", "2 A"],
    ["verb form", "At 120 V AC it is rated to make 1.5 A and to break 15 A [2].", "1.5 A"],
  ])("caught however the assignment is written: %s", (_name, answer, figure) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toMatchObject({ rule: "wrong_column", figure });
  });
  it.each([
    ["only before the figure", "At 120 V AC the make rating is only 15 A [2]."],
    ["bold column word in a bullet", "At 120 V AC:\n- **Break**: 1.5 A [2]"],
    ["two nouns after the column word", "At 120 V AC the continuous current rating is 2 A [2]."],
    ["column word after for", "At 120 V AC the rating is 1.5 A for break [2]."],
    ["a refusal joined to a right claim", "It should not be switched directly because the continuous rating at 120 V AC is 2 A [2]."],
  ])("control, the same wording with the right column passes: %s", (_name, answer) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toBeNull();
  });
  it("stated limit: a figure with no column word attached is not judged, though another figure in the sentence has one", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC the make rating is 15 A and 2 A is the rating you can use [2].", GIVEN)).toBeNull();
  });
  it("control: a column word ahead of a figure, but not attached to it, assigns nothing", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The continuous rating is lower than the 15 A the contact can handle on closing at 120 V AC [2].", GIVEN)).toBeNull();
  });
  it("another device named in a later clause does not excuse a wrong assignment in this one", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The continuous rating is 15 A at 120 V AC, and an interposing relay is not needed [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "15 A" });
  });
  it("control: an uncited stored page is not read for an assignment about something else", () => {
    expect(ratingColumnFinding("Which fuse for the supply?", "The fuse's break rating is 2 A.", [prose(false), stored(false)])).toBeNull();
    expect(ratingColumnFinding("Which fuse for the supply?", "The fuse's break rating is 2 A [2].", [prose(false), stored(true)])).toMatchObject({ rule: "wrong_column" });
  });
  it.each([
    // The safety reviewer's misses on head 2aecea562 (second review).
    ["a respectively list", "At 120 V AC the make and break ratings are 1.5 A and 2 A respectively [2].", "1.5 A"],
    ["a list with no respectively", "At 120 V AC the make and break ratings are 15 A and 2 A [2].", "2 A"],
    ["a slashed list", "At 120 V AC, make / break / continuous: 1.5 A / 2 A / 15 A [2].", "1.5 A"],
    ["a table row under its head row", "| Voltage | Make | Break | Continuous |\n|---|---|---|---|\n| 120 V AC | 1.5 A | 2 A | 15 A | [2]", "1.5 A"],
    ["a table row with two cells swapped", "| Voltage | Make | Break | Continuous |\n| 120 V AC | 15 A | 2 A | 1.5 A | [2]", "2 A"],
    ["a limit put as not more than", "At 120 V AC the make rating is not more than 1.5 A [2].", "1.5 A"],
    ["a limit put as cannot exceed", "At 120 V AC the break rating cannot exceed 15 A [2].", "15 A"],
    ["a limit put as don't go above", "At 120 V AC the break ratings don’t go above 15 A [2].", "15 A"],
    ["a limit put as no higher than", "At 120 V AC the break limit is no higher than 15 A [2].", "15 A"],
    ["the figure's rating named after it", "At 120 V AC the 1.5 A rating is the make rating [2].", "1.5 A"],
    ["rated between word and figure", "At 120 V AC the contact is continuously rated at 1.5 A [2].", "1.5 A"],
    ["a load word after an assigned figure", "At 120 V AC the make rating is 1.5 A motor rating [2].", "1.5 A"],
    ["a figure given to loads by a column verb", "At 120 V AC the contacts break 2 A loads [2].", "2 A"],
  ])("caught: %s", (_name, answer, figure) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toMatchObject({ rule: "wrong_column", figure });
  });
  it("the question's own load figure between the column word and its figure does not hide the assignment", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, "At 120 V AC, the make rating for a 5 A coil load is 1.5 A, and 2 A is the continuous figure [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "1.5 A" });
  });
  it("a load figure the question did not give, between the column word and its figure, does not hide the assignment either", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC, the make rating for a 3 A coil load is 1.5 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "1.5 A" });
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC, the make rating for a 3 A coil load is 15 A [2].", GIVEN)).toBeNull();
  });
  it.each([
    ["an em dash between word and figure", "Break — 15 A at 120 V AC [2].", "15 A"],
    ["a bracketed max between word and figure", "Break (max.) 15 A at 120 V AC [2].", "15 A"],
    ["a two-column table, one column word a row", "| Column | Rating |\n|---|---|\n| Break | 15 A |\n| Make | 1.5 A | [2]", "15 A"],
    ["a three-row table with no head row", "| Make | 1.5 A |\n| Break | 15 A |\n| Continuous | 2 A | [2]", "1.5 A"],
    ["rated between figure and word", "The relay is 2 A rated break at 120 V AC [2].", "2 A"],
    ["at between figure and word", "At 120 V AC the contact can carry 15 A at break duty [2].", "15 A"],
    ["a respectively list with its head behind", "At 120 V AC, 2 A and 15 A are the make and continuous ratings respectively [2].", "2 A"],
  ])("caught (third safety review): %s", (_name, answer, figure) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toMatchObject({ rule: "wrong_column", figure });
  });
  it.each([
    ["an em dash", "Make — 15 A at 120 V AC [2]."],
    ["a bracketed max", "Break (max.) 1.5 A at 120 V AC [2]."],
    ["a two-column table", "| Column | Rating |\n|---|---|\n| Make | 15 A |\n| Break | 1.5 A |\n| Continuous | 2 A | [2]"],
    ["rated between figure and word", "The relay is 15 A rated make at 120 V AC [2]."],
    ["at between figure and word", "At 120 V AC the contact can carry 2 A at continuous duty [2]."],
    ["a respectively list with its head behind", "At 120 V AC, 15 A and 2 A are the make and continuous ratings respectively [2]."],
    ["figures that are above two ratings", "At 120 V AC, 5 A and 10 A are above the break and continuous ratings [2]."],
  ])("passes with the right column (third safety review): %s", (_name, answer) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toBeNull();
  });
  it("a list longer than its head is not given the head's columns by position", () => {
    // Three figures under two column words: the head cannot say which figure is which, so only
    // the attached word counts ("make: 15 A"), and that is right.
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC, break and make: 15 A, 1.5 A, 2 A [2].", GIVEN)).toBeNull();
  });
  it.each([
    ["a respectively list", "At 120 V AC the make and break ratings are 15 A and 1.5 A respectively [2]."],
    ["a slashed list", "At 120 V AC, make / break / continuous: 15 A / 1.5 A / 2 A [2]."],
    ["a table row under its head row", "| Voltage | Make | Break | Continuous |\n|---|---|---|---|\n| 120 V AC | 15 A | 1.5 A | 2 A | [2]"],
    ["a two-figure list and a third on its own", "At 120 V AC the make and break ratings are 15 A and 1.5 A, with 2 A continuous [2]."],
    ["a limit put as not more than", "At 120 V AC the break rating is not more than 1.5 A [2]."],
    ["a limit put as cannot exceed", "At 120 V AC the continuous current cannot exceed 2 A [2]."],
    ["the figure's rating named after it", "At 120 V AC the 15 A rating is the make rating [2]."],
    ["a rating denied after the figure", "Warning: a 15 A continuous rating is not available on this relay; the continuous rating is 2 A at 120 V AC [2]."],
    ["a column verb denied ahead of the figure", "At 120 V AC the contacts are not rated to break 15 A [2]."],
  ])("control, passes: %s", (_name, answer) => {
    expect(ratingColumnFinding(RATING_QUESTION, answer, GIVEN)).toBeNull();
  });
  it("a load figure in the sentence does not excuse a misnamed rating beside it", () => {
    expect(ratingColumnFinding("What can the relay output carry?", "At 120 V AC, a 1 A steady-state load is below the 15 A continuous rating [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "15 A" });
  });
  it("a passage that is one chunk of the page, with no row for the voltage named, says nothing about the figure", () => {
    // Only the 240 V AC row (make 7.5 A, break 0.75 A) reached this chunk.
    const piece = [{ content: P19_STORED.split("\n").filter((l) => !/(?:120 V AC|24 V DC|125 V DC) row: /.test(l)).join("\n"), title: "2080-IN009B-EN-P.pdf", page: 19, cited: true }];
    expect(readColumnLines(piece[0].content).rows.map((r) => r.label)).toEqual(["240 V AC"]);
    expect(ratingColumnFinding(RATING_QUESTION, "At 120 V AC the continuous figure is 7.5 A [1].", piece)).toBeNull();
    expect(ratingColumnFinding("What is the rating at 240 V AC?", "At 240 V AC the continuous figure is 7.5 A [1].", piece)).toMatchObject({ rule: "wrong_column", figure: "7.5 A" });
  });
  it("control: a figure the question itself asks about is the asked duty, whatever column word the answer puts beside it", () => {
    expect(ratingColumnFinding("Can the relay output make 1.5 A at 120 V AC?", "Making 1.5 A at 120 V AC is within the 15 A make rating [2].", GIVEN)).toBeNull();
    expect(ratingColumnFinding("What can the relay output make at 120 V AC?", "Making 1.5 A at 120 V AC is the limit [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "1.5 A" });
  });
  it("a negation that is not on a column word does not excuse the sentence", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "The load should not be switched: the break rating at 120 V AC is 15 A [2].", GIVEN)).toMatchObject({ rule: "wrong_column", figure: "15 A" });
  });
  it("control: a figure the question itself gives is the asked load, not a quotation", () => {
    const q = "Can the relay output switch a 15 A load at 120 V AC?";
    expect(ratingColumnFinding(q, "No. A 15 A load is far over the break rating of 1.5 A and the continuous rating of 2 A at 120 V AC [2].", GIVEN)).toBeNull();
  });
  it("control: a figure whose value also sits on the row with no column read is not judged", () => {
    // 24 V DC prints 1.0 A in one cell across make and break, and 1 A continuous: equal as numbers.
    const q = "What are the relay contact ratings at 24 V DC?";
    expect(ratingColumnFinding(q, "At 24 V DC the contacts make and break 1.0 A, and carry 1 A continuously [2].", GIVEN)).toBeNull();
    expect(ratingColumnFinding(q, "At 24 V DC the make rating is 1 A [2].", GIVEN)).toBeNull();
    expect(ratingColumnFinding("What is the rating at 125 V DC?", "At 125 V DC the contacts make and break 0.22 A [2].", GIVEN)).toBeNull();
  });
  it("control: a figure that is in no column of the rows read", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "A 5 A coil is over the continuous rating; see the table [2].", GIVEN)).toBeNull();
  });
  it("control: the stored page was given but the answer neither cites it nor quotes a placed figure", () => {
    expect(ratingColumnFinding(RATING_QUESTION, "Add a suppression device across the coil before you break the circuit at 3 A [1].", [prose(true), stored(false)])).toBeNull();
  });
  it("control: an uncited stored page is not read for a question that is not about a relay, contact or output", () => {
    expect(ratingColumnFinding("Which fuse for the supply?", "Use a 2 A fuse rated to break the fault current.", [prose(false), stored(false)])).toBeNull();
  });
  it("the earlier rules still come first on a stored page", () => {
    expect(ratingColumnFinding(LOAD_QUESTION, SERVED, GIVEN)).toMatchObject({ rule: "load" });
    expect(ratingColumnFinding(RATING_QUESTION, "The relay output is rated 15 A at 120 V AC [2].", GIVEN)).toMatchObject({ rule: "column" });
  });
});

describe("the replacement text", () => {
  const load = ratingColumnText({ rule: "load", title: "2080-IN009B-EN-P.pdf", page: 19, load: "5 A", row: "120 V AC", lower: ["1.5 A", "2 A"] });
  const noRow = ratingColumnText({ rule: "load", title: "relay.pdf", page: null, load: "5 A", row: null, lower: [] });
  const column = ratingColumnText({ rule: "column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "15 A" });
  const wrong = ratingColumnText({ rule: "wrong_column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "2 A" });
  it("LOAD: names the file, page and row, and shows the figures below the load", () => {
    expect(load).toContain("2080-IN009B-EN-P.pdf, p. 19");
    expect(load).toContain("its 120 V AC row carries figures below your 5 A load: 1.5 A, 2 A. The table's column headings say which figure is which.");
    expect(load).not.toContain("15 A");
  });
  it("LOAD: one lower figure reads in the singular", () => {
    expect(ratingColumnText({ rule: "load", title: "relay.pdf", page: 3, load: "5 A", row: "240 V AC", lower: ["0.75 A"] }))
      .toContain("its 240 V AC row carries a figure below your 5 A load: 0.75 A.");
  });
  it("LOAD with no single row: no figure from the table is shown, and no page when the passage has none", () => {
    expect(noRow).toContain("in relay.pdf lists");
    expect(noRow).toContain("it carries figures below your 5 A load. The row for your voltage and current type (AC or DC) is the one that applies.");
    expect(noRow.replace("5 A load", "")).not.toMatch(/\d\s?A\b/);
  });
  it("COLUMN: names the file and page and repeats no figure", () => {
    expect(column).toContain("2080-IN009B-EN-P.pdf, p. 19");
    expect(column).not.toMatch(/\d\s?A\b/);
  });
  it("WRONG-COLUMN: names the file and page, repeats no figure and names no column for one", () => {
    expect(wrong).toContain("2080-IN009B-EN-P.pdf, p. 19");
    expect(wrong).toContain("the table prints that figure under a different column");
    expect(wrong).not.toMatch(/\d\s?A\b/);
  });
  it("gives no yes and no no, says nothing of what the draft concluded, and claims no column for a figure", () => {
    for (const text of [load, noRow, column, wrong]) {
      expect(text).not.toMatch(/^\W*(?:yes|no)\b/i);
      expect(text).toContain("withholding my draft answer");
      expect(text).toContain("A load that stays on is judged against the continuous figure");
      expect(text).toContain("The make figure is the limit for the surge when the contact closes.");
      expect(text).toContain("For an inductive load such as a coil, the table may also give a volt-ampere (VA) rating, and that applies too.");
    }
    expect(load).not.toMatch(/(?:1\.5|2) A (?:continuous|break|make)/);
  });
  it("draws no lockout banner from the pre-display validator", () => {
    for (const text of [load, noRow, column, wrong]) {
      expect(validateAnswer({ answerText: text, question: LOAD_QUESTION, general: false, served: true, refused: true, evidenceSufficient: true, manualSearchRunning: null }))
        .toEqual({ ok: true });
    }
  });
});
