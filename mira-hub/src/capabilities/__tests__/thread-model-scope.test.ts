// A project's manual status names the project's machine. A thread inside that
// project that asked about a DIFFERENT exact model must not show it (staging
// tablet walk 2026-11-21: "Find me the manual for AutomationDirect GS11N-20P25"
// in a GS11N-20P2 project showed "…coverage for GS11N-20P2" plus the manual
// link under an answer that said GS11N-20P25 is not listed).
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope
import { describe, it, expect } from "vitest";
import { threadNamesOtherModel } from "@/capabilities/notebook-manual-acquisition";

const GS10 = { manufacturer: "AutomationDirect", model: "GS11N-20P2", catalogNumber: "" };

describe("threadNamesOtherModel", () => {
  it("hides the status under a thread that asked for a look-alike model", () => {
    expect(threadNamesOtherModel(["Find me the manual for AutomationDirect GS11N-20P25"], GS10)).toBe(true);
  });

  it("keeps the status under a thread that asked for the project's own model", () => {
    expect(threadNamesOtherModel(["Find me the manual for AutomationDirect GS11N-20P2"], GS10)).toBe(false);
  });

  it("keeps the status under the photo thread, whose question names no model", () => {
    expect(threadNamesOtherModel(["Find me the manual"], GS10)).toBe(false);
  });

  it("keeps the status for an empty thread", () => {
    expect(threadNamesOtherModel([], GS10)).toBe(false);
  });

  it("matches the catalog number as the project's identifier", () => {
    const withCatalog = { manufacturer: "AutomationDirect", model: "DURApulse GS10", catalogNumber: "GS11N-20P2" };
    expect(threadNamesOtherModel(["Find me the manual for AutomationDirect GS11N-20P2"], withCatalog)).toBe(false);
    expect(threadNamesOtherModel(["Find me the manual for AutomationDirect GS11N-20P25"], withCatalog)).toBe(true);
  });

  it("decides on the thread's latest question that names a model", () => {
    const questions = [
      "Find me the manual for AutomationDirect GS11N-20P25",
      "What does the keypad show?",
      "Find me the manual for AutomationDirect GS11N-20P2",
    ];
    expect(threadNamesOtherModel(questions, GS10)).toBe(false);
    expect(threadNamesOtherModel([...questions].reverse(), GS10)).toBe(true);
  });
});
