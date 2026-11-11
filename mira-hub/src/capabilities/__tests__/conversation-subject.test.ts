import { describe, expect, it } from "vitest";
import { openQuestions, readSubject, SUBJECT_READ_STEPS } from "../conversation-subject";

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
