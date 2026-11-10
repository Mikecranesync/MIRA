import { describe, expect, it } from "vitest";
import { openQuestions } from "../conversation-subject";

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

  it("carries at most six questions back and skips blank ones", () => {
    const many = Array.from({ length: 9 }, (_, i) => refused(`q${i}`));
    expect(openQuestions(many)).toEqual(["q8", "q7", "q6", "q5", "q4", "q3"]);
    expect(openQuestions([refused("  "), { question: null, answerStatus: "insufficient_evidence" }, refused("kept")])).toEqual(["kept"]);
  });
});
