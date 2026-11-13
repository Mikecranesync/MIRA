import { describe, expect, it } from "vitest";
import { openQuestions, readSubject, returnsToRecord, SUBJECT_READ_STEPS } from "../conversation-subject";

const refused = (question: string) => ({ question, answerStatus: "insufficient_evidence", basis: null });
const fromManual = (question: string) => ({ question, answerStatus: "answered", basis: "workspace_evidence" });
const fromLibrary = (question: string) => ({ question, answerStatus: "answered", basis: "oem_documentation" });
const safetyStop = (question: string) => ({ question, answerStatus: "answered", basis: null });
const general = (question: string) => ({ question, answerStatus: "answered", basis: "general_reasoning" });
const failed = (question: string) => ({ question, answerStatus: "error", basis: null });

describe("which earlier questions the next one is still about", () => {
  it("no earlier turns, nothing open", () => {
    expect(openQuestions([])).toEqual([]);
  });

  it("a refused question stays open; newest first", () => {
    expect(openQuestions([refused("plate reads GS11N-20P2"), refused("what does ocA mean")])).toEqual([
      "what does ocA mean",
      "plate reads GS11N-20P2",
    ]);
  });

  it.each([
    ["a manual", fromManual],
    ["the shared library", fromLibrary],
  ])("an answer from %s closes everything before it", (_from, answered) => {
    expect(openQuestions([refused("plate reads GS11N-20P2"), answered("Micro820 supply voltage?")])).toEqual([]);
    expect(openQuestions([refused("old"), answered("closed"), refused("new one")])).toEqual(["new one"]);
  });

  it.each([
    ["a safety stop", safetyStop],
    ["a general-reasoning answer", general],
    ["a failed turn", failed],
  ])("%s does not close the subject", (_what, turn) => {
    expect(openQuestions([refused("plate reads GS11N-20P2"), turn("can I swap the fan while it is powered?")])).toEqual([
      "can I swap the fan while it is powered?",
      "plate reads GS11N-20P2",
    ]);
  });

  it("carries every open question that was read and skips blank ones", () => {
    // Was "at most six": a model named seven turns back fell out of reach and
    // the next model-less question was answered from another product's sheet
    // (cheap review round 9 on #5389). How far back is read is the caller's
    // choice now (SUBJECT_READ_STEPS); nothing read is dropped here.
    const many = Array.from({ length: 9 }, (_, i) => refused(`q${i}`));
    expect(openQuestions(many)).toEqual(["q8", "q7", "q6", "q5", "q4", "q3", "q2", "q1", "q0"]);
    expect(openQuestions([refused("  "), { question: null, answerStatus: "insufficient_evidence" }, refused("kept")])).toEqual(["kept"]);
  });
});

describe("whether the start of the open run was seen", () => {
  it("fewer turns than were asked for: the conversation began inside the read", () => {
    expect(readSubject([], 6)).toEqual({ questions: [], complete: true });
    expect(readSubject([refused("a"), refused("b")], 6)).toEqual({ questions: ["b", "a"], complete: true });
  });

  it("a full read with no document answer in it: older turns may still be open", () => {
    const six = Array.from({ length: 6 }, (_, i) => refused(`q${i}`));
    expect(readSubject(six, 6)).toEqual({ questions: ["q5", "q4", "q3", "q2", "q1", "q0"], complete: false });
    expect(readSubject([...six, general("g"), safetyStop("s"), failed("f")].slice(-6), 6).complete).toBe(false);
  });

  it.each([
    ["a manual", fromManual],
    ["the shared library", fromLibrary],
  ])("a full read that holds an answer from %s is complete, and nothing before that answer is carried", (_from, answered) => {
    const read = readSubject([refused("old"), answered("closed"), refused("n1"), refused("n2"), refused("n3"), refused("n4")], 6);
    expect(read).toEqual({ questions: ["n4", "n3", "n2", "n1"], complete: true });
  });

  it("the read steps start at six and only grow", () => {
    expect(SUBJECT_READ_STEPS[0]).toBe(6);
    expect([...SUBJECT_READ_STEPS]).toEqual([...SUBJECT_READ_STEPS].sort((a, b) => a - b));
    expect(new Set(SUBJECT_READ_STEPS).size).toBe(SUBJECT_READ_STEPS.length);
  });
});

// Mike 2026-11-13 (CV-101 benchmark D-A, option A): "back to mine" / "back to my drive" ends the
// carry of a refused look-alike; typing nothing after a sibling still means the sibling.
describe("whether a question returns to the technician's own unit", () => {
  it.each([
    "ok back to mine, what frame size is it",
    "Back to my drive - what is the rated input current?",
    "back to our unit now, what does ocd mean",
    "right, back to my own PLC: how much clearance does it need",
    "back to this project's drive, frame size?",
    "and back to ours, supply voltage?",
    "I'm not sure about that one, back to mine: what frame size is it",
    "ok, now back to my drive",
    "let's go back to mine, what is its rated input current?",
    "go back to mine now. frame size?",
    "Back to mine please - what is the rated output current",
  ])("is a return: %s", (q) => {
    expect(returnsToRecord(q)).toBe(true);
  });

  it.each([
    "and its VT rated current?",
    "what about the GS13N-20P2, same thing?",
    "what about my other drive, same thing?",
    "back to the question, what is its VT rated current?",
    "the back of the drive has a fan",
    "what does my drive need for supply voltage",
    "go back to P00.04 and set it",
    "",
    // Codex r1 on #5464 (F1): a negated or deferred mention keeps the sibling subject.
    "before we go back to mine, what is its rated input current?",
    "do not go back to mine yet, what is its rated input current?",
    "don't go back to my drive, what about its VT current",
    "until we're back to mine, same thing?",
    "if we go back to mine later, what would its frame size be",
    // Codex r2 on #5464 (F1): a deferral or cancellation AFTER the phrase keeps the sibling too.
    "let's go back to mine later; what is its rated input current?",
    "go back to mine? No, stay on this one. What is its rated input current?",
    "back to mine or stay on this one?",
    "should we go back to my drive at some point, what's its VT current",
    "ok back to mine?",
    "I'd rather not go back to mine, what about its VT current",
    // Fails closed: with no clause break the return is not plain, and the carry stays.
    "ok back to mine what frame size is it",
  ])("is not a return: %s", (q) => {
    expect(returnsToRecord(q)).toBe(false);
  });

  it("accepted residue: a reversal in a LATER clause is not detected (the sibling is re-named by typing it)", () => {
    expect(returnsToRecord("go back to mine. No, stay on this one. What is its rated input current?")).toBe(true);
  });
});
