/**
 * #5706 / Codex r1 + r2 on #5764 — what a photo reading gives the model check.
 * The photo's public text is judged exactly as if typed (manual-rag.ts); these
 * pin which text that is (never a serial), the fail-closed gates (ending an
 * earlier subject; telling which machine is meant at all), the one join rule
 * shared by the live turn and the carry, and the one question asked instead.
 * Readings are verbatim staging observations where noted; the rest isolate one
 * field each.
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-subject.test.ts
 */
import { describe, expect, it } from "vitest";
import { questionWithPhoto, readSubject } from "../conversation-subject";
import { photoSubjectUnclearText } from "../named-model-mismatch";
import { modelLabels, namesOneMachine, photoIsAmbiguous, photoModelText } from "../photo-subject";

// Staging turn b6429301 (tablet walk 2026-11-21).
const GS20 =
  'Below it, in black text, are lines reading "GS20-23P0", "AC Variable Frequency Drive", "Input 3Ph 230VAC 3HP 11.2A", "Output 3Ph 0-230V 60Hz 9.6A", and "S/N: GS20-US-0031482". No connectors are visible.';
// Staging whole-panel photo (notebook aca65409): several devices.
const PANEL = "Center lower is a black AutomationDirect DuraPulse GS10 drive. Next to it is a gray Allen-Bradley Micro820 module.";

describe("photoModelText: public text only, never a serial", () => {
  it("keeps the plate's model and drops its serial", () => {
    const text = photoModelText(GS20);
    expect(text).toContain("GS20-23P0");
    expect(text).not.toContain("GS20-US");
  });

  it("a serial printed before its label is dropped too (Codex r2 F4)", () => {
    expect(photoModelText('The label reads "GS20-23P0 (S/N)". The model is unreadable.')).toBeNull();
  });

  it("nothing after a serial label is read", () => {
    expect(photoModelText('The model is not readable; the only readable field is "S/N: PF 525".')).toBeNull();
  });

  it("a labelled model field is read wherever it sits, one token, never the serial beside it", () => {
    const after = photoModelText('Label: "S/N: GS11N 20P2", then "MODEL: GS20-23P0".');
    expect(after).toContain("GS20-23P0");
    expect(after).not.toContain("GS11N");
    const runOn = photoModelText("Label text S/N 12345678 MODEL GS20-23P0 SERIAL GS11N 20P2");
    expect(runOn).toContain("GS20-23P0");
    expect(runOn).not.toContain("GS11N");
  });

  it("an unreadable plate, an empty reading and a prose 'model' give nothing", () => {
    expect(photoModelText("A drive label photographed with heavy glare; the text is not readable.")).toBeNull();
    expect(photoModelText("The model of the drive is not readable.")).toBeNull();
    expect(photoModelText("   ")).toBeNull();
    expect(photoModelText(null)).toBeNull();
  });
});

describe("namesOneMachine: the gate on ending an earlier subject", () => {
  it("a family name beside its own full number is one machine", () => {
    expect(namesOneMachine("A DURApulse GS20 drive; the label reads GS20-23P0.")).toBe(true);
    expect(namesOneMachine("Nameplate: Allen-Bradley PowerFlex 4M AC drive.")).toBe(true);
  });

  it("one full number beside a longer one is two machines (Codex r2 F2)", () => {
    expect(namesOneMachine("Two drives labeled GS11N-20P2 and GS11N-20P2A.")).toBe(false);
    expect(namesOneMachine("Two drives labeled GS20-23P0 and GS20-21P0.")).toBe(false);
  });

  it("two families, or a panel, are more than one", () => {
    expect(namesOneMachine("A panel with a GS10 or GS20 drive.")).toBe(false);
    expect(namesOneMachine(PANEL)).toBe(false);
  });
});

describe("questionWithPhoto: one join rule", () => {
  it("joins the photo's public text to a question that names no model", () => {
    const q = questionWithPhoto("Find me the manual", GS20, false);
    expect(q.text).toContain("Find me the manual");
    expect(q.text).toContain("GS20-23P0");
    expect(q.text).not.toContain("GS20-US");
    expect(q.releases).toBe(true);
  });

  it("a model typed in the question outranks the photo", () => {
    expect(questionWithPhoto("Manual for the GS11N-20P2", GS20, false)).toEqual({ text: "Manual for the GS11N-20P2", photo: null, releases: false, ambiguous: false });
  });

  it("a return to the unit on record outranks the photo; with no record it is no return", () => {
    expect(questionWithPhoto("Back to mine. What was its firmware build?", GS20, true).photo).toBeNull();
    expect(questionWithPhoto("Back to mine. What was its firmware build?", GS20, false).photo).toContain("GS20-23P0");
  });

  it("a panel joins but does not end an earlier subject", () => {
    const q = questionWithPhoto("Find me the manual", PANEL, false);
    expect(q.photo).toContain("GS10");
    expect(q.releases).toBe(false);
  });
});

describe("readSubject carries a turn's photo by the same rule (Codex r1 F5)", () => {
  const open = (question: string, photoText?: string) => ({ question, answerStatus: "insufficient_evidence", basis: null, photoText });

  it("folds the photo into the question that named no model", () => {
    const { questions } = readSubject([open("Find me the manual", GS20)], 6);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("GS20-23P0");
    expect(questions[0]).not.toContain("GS20-US");
  });

  it("a photo with no question text still opens a subject", () => {
    expect(readSubject([open("", GS20)], 6).questions[0]).toContain("GS20-23P0");
  });

  it("a photo that does not end the subject before it is marked unclear (the follow-up asks too)", async () => {
    const read = readSubject([open("What about the GS11N-20P5?"), open("Find me the manual", "Two drives labeled GS20-23P0 and GS20-21P0.")], 6);
    expect(read.unclear).toEqual([true, false]);
  });

  it("a photo the reader cannot resolve to one machine is unclear on its own", async () => {
    expect(readSubject([open("Find me the manual", PANEL)], 6).unclear).toEqual([true]);
  });

  it("control: a photo naming one machine is clear, and no flag is returned", async () => {
    const read = readSubject([open("What about the GS11N-20P5?"), open("Find me the manual", GS20)], 6);
    expect(read.questions[0]).toContain("GS20-23P0");
    expect(read.unclear).toBeUndefined();
  });

  it("an earlier subject behind a return to the unit on record does not make the photo unclear", async () => {
    const twoGS20 = "Two drives labeled GS20-23P0 and GS20-21P0.";
    expect(readSubject([open("What about the GS11N-20P5?"), open("ok back to mine"), open("Find me the manual", twoGS20)], 6, true).unclear).toBeUndefined();
    expect(readSubject([open("What about the GS11N-20P5?"), open("ok back to mine"), open("Find me the manual", twoGS20)], 6, false).unclear?.[0]).toBe(true);
  });

  it("a document answer still closes the run", () => {
    const { questions, complete } = readSubject([open("Find me the manual", GS20), { question: "Input voltage?", answerStatus: "answered", basis: "workspace_evidence" }], 6);
    expect(questions).toEqual([]);
    expect(complete).toBe(true);
  });
});

describe("the which-machine question: one question, model labels only", () => {
  it("names what the reader cannot tell apart", () => {
    expect(photoIsAmbiguous(PANEL)).toBe(true);
    expect(photoIsAmbiguous(photoModelText(GS20) ?? "")).toBe(false);
    expect(modelLabels(PANEL)).toEqual(["GS10", "Micro820"]);
    expect(modelLabels("Two drives labeled GS20-23P0 and GS20-21P0.")).toEqual(["GS20-23P0", "GS20-21P0"]);
  });

  it("has one wording per case, each ending in one question", () => {
    const alone = photoSubjectUnclearText({ shown: ["GS10", "Micro820"], earlier: [] });
    expect(alone).toContain("Your photo shows GS10 / Micro820, and I can't tell which machine you mean");
    const earlier = photoSubjectUnclearText({ shown: ["GS20-23P0", "GS20-21P0"], earlier: ["GS11N-20P5"] });
    expect(earlier).toContain("earlier in this conversation you asked about GS11N-20P5. Which machine is this question about?");
    const carried = photoSubjectUnclearText({ shown: ["GS20-23P0", "GS20-21P0"], earlier: [], carried: true });
    expect(carried).toContain("Earlier in this conversation your photo showed GS20-23P0 / GS20-21P0");
    for (const text of [alone, earlier, carried]) expect(text.split("?").length - 1).toBe(1);
  });
});

