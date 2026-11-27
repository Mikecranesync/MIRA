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
import { modelLabels, namesOneMachine, photoIsAmbiguous, photoModelText, readPhotoModel } from "../photo-subject";

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
    expect(questionWithPhoto("Manual for the GS11N-20P2", GS20, false)).toEqual({ text: "Manual for the GS11N-20P2", photo: null, releases: false, ambiguous: false, unknown: false, hidden: [] });
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
    // A plate naming a model that is not specific enough to end a subject, yet
    // not ambiguous on its own (a family name beside its order number).
    const tp700 = "Siemens TP700 Comfort. Order No. 6AV2124-0GC01-0AX0.";
    expect(readSubject([open("What about the GS11N-20P5?"), open("ok back to mine"), open("Find me the manual", tp700)], 6, true).unclear).toBeUndefined();
    expect(readSubject([open("What about the GS11N-20P5?"), open("ok back to mine"), open("Find me the manual", tp700)], 6, false).unclear?.[0]).toBe(true);
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
    const unknown = photoSubjectUnclearText({ shown: [], earlier: [], unknown: true });
    expect(unknown).toContain("a model on its label is printed among the serial or asset numbers");
    const carriedUnknown = photoSubjectUnclearText({ shown: [], earlier: [], carried: true });
    expect(carriedUnknown).toContain("you sent a photo I can't tell the machine from");
    for (const text of [alone, earlier, carried, unknown, carriedUnknown]) expect(text.split("?").length - 1).toBe(1);
  });
});


// #5706 review of 185f15c, finding 1 (reproduced as a wrong-model answer): the
// public-text cut dropped a model printed after a serial or asset label, so the
// photo named nothing and the project's manual answered. Such a model is still
// never read (ADR-0036) — it makes the photo's machine unknown, which asks.
describe("readPhotoModel: a model among the private fields makes the machine unknown", () => {
  it.each([
    ["after a serial label", "Serial No 12345678 GS20-23P0 AC drive"],
    ["after a unit label", "Unit: GS20-23P0 240V 3PH"],
    ["after a machine label", "Machine: GS20-23P0 AC drive"],
    ["as the serial value itself, nothing else readable", 'The label reads "GS20-23P0 (S/N)". The model is unreadable.'],
    ["a look-alike after the serial", "GS11N-20P2 AC drive Serial No 2507A123 GS11N-20P2A"],
    ["another family after the serial", "GS11N-20P2 AC drive Serial No 2507A123 GS20-23P0"],
  ])("%s", (_name, reading) => {
    const read = readPhotoModel(reading);
    expect(read.unknown).toBe(true);
    // Never read: nothing after the label reaches the model text.
    expect(read.text ?? "").not.toMatch(/12345678|2507A123|GS20-23P0 240V|GS11N-20P2A/);
  });

  it.each([
    ["the model before the serial", "GS20-23P0 AC drive. Serial No 12345678"],
    ["the plate's own model repeated after the serial", "GS11N-20P2 AC drive Serial No 2507A123 GS11N-20P2"],
    ["a serial beginning with the plate's family (staging b6429301)", GS20],
    ["a labelled MODEL field decides", 'Label: "MODEL: GS20-23P0", "S/N: GS11N 20P2".'],
    ["no model anywhere", "A keypad with MENU and ENTER. Serial No 12345678."],
  ])("control: %s is not unknown", (_name, reading) => {
    expect(readPhotoModel(reading).unknown).toBe(false);
  });

  it("removes a serial as a whole code only, never from inside a model", () => {
    expect(photoModelText("GS11N-20P2 drive S/N: 20P2")).toContain("GS11N-20P2");
    const suffix = photoModelText("GS11N-20P2 AC drive, 2507A123 (S/N).") ?? "";
    expect(suffix).toContain("GS11N-20P2");
    expect(suffix).not.toContain("2507A123");
  });

  it("joins as unknown: never releases an earlier subject; a typed model still outranks it", () => {
    const q = questionWithPhoto("Find me the manual", "Serial No 12345678 GS20-23P0 AC drive", false);
    expect(q).toMatchObject({ photo: null, unknown: true, releases: false });
    expect(questionWithPhoto("Manual for the GS11N-20P2", "Serial No 12345678 GS20-23P0", false).unknown).toBe(false);
    // Public text naming one machine does not release when a private model is unknown.
    const both = questionWithPhoto("Find me the manual", "GS11N-20P2 AC drive Serial No 2507A123 GS20-23P0", false);
    expect(both).toMatchObject({ unknown: true, releases: false });
    expect(both.photo).toContain("GS11N-20P2");
  });

  it("an open photo that could not be read back is unknown, and the carry flags it", () => {
    expect(questionWithPhoto("Find me the manual", null, false, true).unknown).toBe(true);
    expect(questionWithPhoto("Manual for the GS20-23P0", null, false, true).unknown).toBe(false);
    const read = readSubject([{ question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null, photoUnread: true }], 6);
    expect(read.questions).toEqual(["Find me the manual"]);
    expect(read.unclear).toEqual([true]);
  });

  it("Codex r3 F1: a MODEL field decides only when it names a full number", () => {
    expect(readPhotoModel("MODEL: Micro820. S/N: 12345678. Catalog No. 2080-LC20-20QWB.").hidden).toContain("2080-LC20-20QWB");
    expect(readPhotoModel("MODEL: GS11N. S/N: 12345678 GS20-23P0").unknown).toBe(true);
    expect(readPhotoModel("MODEL: 2080-LC20-20AWB. Unit: 2080-LC20-20QWB").hidden).toEqual([]);
    expect(readPhotoModel("MODEL: GS20-23P0. S/N: 12345678 GS11N-20P2").unknown).toBe(false);
  });

  it("Codex r3 F2: two full numbers are ambiguous; a family beside its own number is not", () => {
    expect(photoIsAmbiguous('Two drives labeled "GS20-23P0" and "GS20-21P0".')).toBe(true);
    expect(photoIsAmbiguous("Two drives labeled GS11N-20P2 and GS11N-20P2A.")).toBe(true);
    expect(photoIsAmbiguous('Plate reads "GS20-23P0". GS20 series AC drive.')).toBe(false);
    expect(photoIsAmbiguous("Siemens TP700 Comfort. Order No. 6AV2124-0GC01-0AX0.")).toBe(false);
  });

  it("a serial value is removed as a whole code: a model it begins stays readable", () => {
    expect(readPhotoModel("GS11N-20P2 drive S/N: GS11N").text).toContain("GS11N-20P2");
  });

  it("a carried 'back to mine' keeps its photo out only with a catalog number on record", () => {
    const turns = [{ question: "Back to mine. What was its firmware build?", answerStatus: "insufficient_evidence", basis: null, photoText: 'Plate reads "GS20-23P0".' }];
    expect(readSubject(turns, 6, true).questions[0]).not.toContain("GS20");
    expect(readSubject(turns, 6, false).questions[0]).toContain("GS20-23P0");
  });

  it("private-field codes are kept for the check only, and never with a labelled MODEL field", () => {
    expect(readPhotoModel("Allen-Bradley Micro820. Serial No 12345678 2080-LC20-20QWB").hidden).toContain("2080-LC20-20QWB");
    expect(readPhotoModel("Allen-Bradley Micro820. Serial No 12345678 2080-LC20-20QWB").text).not.toContain("QWB");
    expect(readPhotoModel('Label: "MODEL: 2080-LC20-20AWB", "Unit: 2080-LC20-20QWB".').hidden).toEqual([]);
    const read = readSubject([{ question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null, photoText: "Unit: 2080-LC20-20QWB" }], 6);
    expect(read.hidden).toEqual([["2080-LC20-20QWB"]]);
    expect(readSubject([{ question: "Find me the manual", answerStatus: "insufficient_evidence", basis: null }], 6).hidden).toBeUndefined();
  });

  it("a photo-only turn (a LOOK with no question) is carried by the same rule", () => {
    const look = { question: "", answerStatus: "look", basis: null, photoText: GS20 };
    expect(readSubject([look], 6).questions[0]).toContain("GS20-23P0");
    const hidden = { question: "", answerStatus: "look", basis: null, photoText: "Serial No 12345678 GS20-23P0" };
    const read = readSubject([hidden], 6);
    expect(read.questions).toEqual([""]);
    expect(read.unclear).toEqual([true]);
  });
});
