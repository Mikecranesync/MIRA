// #5466 — an answer drawn from a contact-ratings table must keep its columns apart.
//
// Pure-function tests for rating-column.ts. The route-level proof (the draft is
// withheld before a byte of it is released) is rating-column.route.test.ts.
//
// Run: npx vitest run src/capabilities/__tests__/rating-column.test.ts
import { describe, expect, it } from "vitest";
import { validateAnswer } from "../answer-validation";
import { ratingColumnFinding, ratingColumnText, ratingRowAmperes, type RatingPassage } from "../rating-column";

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
const table = (cited: boolean): RatingPassage => ({ content: P19, title: "2080-IN009B-EN-P.pdf", page: 19, cited });
const prose = (cited: boolean): RatingPassage => ({ content: P12, title: "2080-IN009B-EN-P.pdf", page: 12, cited });
const CITED = [prose(true), table(true)];

const LOAD_QUESTION = "Can I switch a 5 A, 120 V AC motor contactor coil load directly from a Micro820 relay output?";
const RATING_QUESTION = "What is the relay output rated for at 120 V AC?";
// The answer served on staging 6da4ab674, 2026-11-13 (trace 3b78d674…).
const SERVED =
  "Yes—the Micro820 relay output is rated for 15 A at 120 V AC, but inductive loads like motor starters and solenoids "
  + "should have surge suppression across the coil to protect the contacts [2][1]. Without suppression, switching inductive "
  + "loads can significantly reduce relay contact life [1].";
const NAMED =
  "No. At 120 V AC the relay contacts are rated 15 A make, 1.5 A break and 2 A continuous [2], so a 5 A coil load is over the continuous rating.";

describe("what reads as a contact-ratings table", () => {
  it("reads the ampere figures on the rating rows of the real page", () => {
    expect(ratingRowAmperes(P19).sort((a, b) => a - b)).toEqual([0.22, 0.75, 1, 1.5, 2, 7.5, 15]);
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

describe("the replacement text", () => {
  const load = ratingColumnText({ rule: "load", title: "2080-IN009B-EN-P.pdf", page: 19, load: "5 A", row: "120 V AC", lower: ["1.5 A", "2 A"] });
  const noRow = ratingColumnText({ rule: "load", title: "relay.pdf", page: null, load: "5 A", row: null, lower: [] });
  const column = ratingColumnText({ rule: "column", title: "2080-IN009B-EN-P.pdf", page: 19, figure: "15 A" });
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
  it("gives no yes and no no, says nothing of what the draft concluded, and claims no column for a figure", () => {
    for (const text of [load, noRow, column]) {
      expect(text).not.toMatch(/^\W*(?:yes|no)\b/i);
      expect(text).toContain("withholding my draft answer");
      expect(text).toContain("A load that stays on is judged against the continuous figure");
      expect(text).toContain("The make figure is the limit for the surge when the contact closes.");
      expect(text).toContain("For an inductive load such as a coil, the table may also give a volt-ampere (VA) rating, and that applies too.");
    }
    expect(load).not.toMatch(/(?:1\.5|2) A (?:continuous|break|make)/);
  });
  it("draws no lockout banner from the pre-display validator", () => {
    for (const text of [load, noRow, column]) {
      expect(validateAnswer({ answerText: text, question: LOAD_QUESTION, general: false, served: true, refused: true, evidenceSufficient: true, manualSearchRunning: null }))
        .toEqual({ ok: true });
    }
  });
});
