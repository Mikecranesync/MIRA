/**
 * #5706 / Codex r1 on #5764 — which ONE machine a photo reading names.
 * Readings are verbatim staging observations where noted; the rest isolate one
 * field each (F1 close-name models, F2 two numbers of a family, F4 serials).
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-subject.test.ts
 */
import { describe, expect, it } from "vitest";
import { readSubject } from "../conversation-subject";
import { photoSubjectText } from "../photo-subject";

// Staging turn b6429301 (tablet walk 2026-11-21).
const GS20 =
  'Below it, in black text, are lines reading "GS20-23P0", "AC Variable Frequency Drive", "Input 3Ph 230VAC 3HP 11.2A", "Output 3Ph 0-230V 60Hz 9.6A", and "S/N: GS20-US-0031482". No connectors are visible.';

describe("photoSubjectText", () => {
  it("names the plate's model and never its serial", () => {
    const text = photoSubjectText(GS20);
    expect(text).toContain("GS20-23P0");
    expect(text).not.toContain("GS20-US");
  });

  it.each([
    ["PowerFlex 4M", "Nameplate: Allen-Bradley PowerFlex 4M AC drive."],
    ["SMC-50", "Nameplate: Allen-Bradley SMC-50 solid-state controller."],
  ])("reads the close-name model %s (F1)", (_m, reading) => {
    expect(photoSubjectText(reading)).not.toBeNull();
  });

  it("two numbers of one family are two machines (F2)", () => {
    expect(photoSubjectText('A panel with two drives labeled "GS20-23P0" and "GS20-21P0".')).toBeNull();
    // Control: the family name beside its own full number is one machine.
    expect(photoSubjectText('A DURApulse GS20 drive; the label reads "GS20-23P0".')).not.toBeNull();
  });

  it("a model field's value is one token: it never runs on into a serial (F4)", () => {
    const text = photoSubjectText("Label text S/N 12345678 MODEL GS20-23P0 SERIAL GS11N 20P2");
    expect(text).toContain("GS20-23P0");
    expect(text).not.toContain("GS11N");
  });

  it("two-family readings the single-token reader calls ambiguous name no machine", () => {
    expect(photoSubjectText("A panel with a GS10 or GS20 drive.")).toBeNull();
    expect(photoSubjectText("Micro820 and Micro850 controllers side by side.")).toBeNull();
  });

  it("nothing after a serial label is read as a model (F4)", () => {
    expect(photoSubjectText('The model is not readable; the only readable field is "S/N: PF 525".')).toBeNull();
    const text = photoSubjectText('Label: "S/N: GS11N 20P2", then "MODEL: GS20-23P0".');
    expect(text).toContain("GS20-23P0");
    expect(text).not.toContain("GS11N");
  });

  it("a panel, an unreadable plate and an empty reading name no machine", () => {
    expect(photoSubjectText("A black AutomationDirect DuraPulse GS10 drive beside an Allen-Bradley Micro820 module.")).toBeNull();
    expect(photoSubjectText("A drive label photographed with heavy glare; the text is not readable.")).toBeNull();
    expect(photoSubjectText("   ")).toBeNull();
    expect(photoSubjectText(null)).toBeNull();
  });

  it("a prose 'model' with no number captures nothing", () => {
    expect(photoSubjectText("The model of the drive is not readable.")).toBeNull();
  });
});

describe("readSubject carries an open question's photo machine (F5)", () => {
  it("folds the photo's machine into a question that named none", () => {
    const { questions } = readSubject([{ question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null, photoText: GS20 }], 6);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("Find me the manual");
    expect(questions[0]).toContain("GS20-23P0");
    expect(questions[0]).not.toContain("GS20-US");
  });

  it("a model typed in that question outranks its photo", () => {
    const { questions } = readSubject([{ question: "Manual for the GS11N-20P2", answerStatus: "insufficient_evidence", basis: null, photoText: GS20 }], 6);
    expect(questions).toEqual(["Manual for the GS11N-20P2"]);
  });

  it("a photo naming no single machine adds nothing", () => {
    const { questions } = readSubject(
      [{ question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null, photoText: 'Two drives "GS20-23P0" and "GS20-21P0".' }],
      6,
    );
    expect(questions).toEqual(["Find me the manual"]);
  });

  it("a document answer still closes the run, photo or not", () => {
    const { questions, complete } = readSubject(
      [
        { question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null, photoText: GS20 },
        { question: "Input voltage?", answerStatus: "answered", basis: "workspace_evidence" },
      ],
      6,
    );
    expect(questions).toEqual([]);
    expect(complete).toBe(true);
  });

  it("a photo with no question text still opens a subject", () => {
    const { questions } = readSubject([{ question: "", answerStatus: "insufficient_evidence", basis: null, photoText: GS20 }], 6);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("GS20-23P0");
  });
});
