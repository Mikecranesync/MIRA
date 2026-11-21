// A project's manual status names the project's machine. A thread inside that
// project that asked about a DIFFERENT exact model must not show it (staging
// tablet walk 2026-11-21: "Find me the manual for AutomationDirect GS11N-20P25"
// in a GS11N-20P2 project showed "…coverage for GS11N-20P2" plus the manual
// link under an answer that said GS11N-20P25 is not listed). #5750.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/thread-model-scope
import { describe, it, expect } from "vitest";
import { threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const GS10 = { manufacturer: "AutomationDirect", model: "GS11N-20P2", catalogNumber: "", recordCatalog: null };
const CONFIRMED = { manufacturer: "AutomationDirect", model: "DURApulse GS10", catalogNumber: "GS11N-20P2", recordCatalog: "GS11N-20P2" };

describe("threadStatusScope", () => {
  it("is other for a look-alike model named with its maker", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25"], GS10)).toBe("other");
  });

  it("is own for the project's own model", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P2"], GS10)).toBe("own");
  });

  it("settles nothing for the photo turn, a follow-up, or an empty thread", () => {
    expect(threadStatusScope(["Find me the manual"], GS10)).toBe("undecided");
    expect(threadStatusScope(["What does the keypad show?"], GS10)).toBe("undecided");
    expect(threadStatusScope([], GS10)).toBe("undecided");
  });

  it("settles nothing for the family name the manual is titled with", () => {
    expect(threadStatusScope(["Find me the GS10 manual"], GS10)).toBe("undecided");
  });

  it("matches the catalog number as the project's identifier", () => {
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P2"], CONFIRMED)).toBe("own");
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25"], CONFIRMED)).toBe("other");
  });

  it("decides on the newest question that settles it", () => {
    const questions = [
      "Find me the manual for AutomationDirect GS11N-20P25",
      "What does the keypad show?",
      "Find me the manual for AutomationDirect GS11N-20P2",
    ];
    expect(threadStatusScope(questions, GS10)).toBe("own");
    expect(threadStatusScope([...questions].reverse(), GS10)).toBe("other");
  });

  // #5750 Codex F2: a model-only request and a conflicting maker.
  it("is other for a look-alike named without a maker", () => {
    expect(threadStatusScope(["Find me the manual for GS11N-20P25"], GS10)).toBe("other");
    expect(threadStatusScope(["what does oC mean on a GS11N-20P25"], GS10)).toBe("other");
  });

  it("is other for the same model code under another maker", () => {
    expect(threadStatusScope(["Find me the manual for Siemens GS11N-20P2"], GS10)).toBe("other");
  });

  it("is own for the project's model under an alias of its maker, or with no maker", () => {
    expect(threadStatusScope(["Find me the manual for Automation Direct GS11N-20P2"], GS10)).toBe("own");
    expect(threadStatusScope(["what does oC mean on the GS11N-20P2"], GS10)).toBe("own");
  });

  // #5750 Codex F3: an explicit return to the confirmed unit is a boundary.
  it("is own after a return to the confirmed unit, and on the follow-up after it", () => {
    const sibling = "Find me the manual for AutomationDirect GS11N-20P25";
    const back = "OK, back to my drive. Find me the manual.";
    expect(threadStatusScope([sibling, back], CONFIRMED)).toBe("own");
    expect(threadStatusScope([sibling, back, "What is the rated current?"], CONFIRMED)).toBe("own");
  });

  it("control: without a confirmed catalog number, 'my drive' refers to nothing on record", () => {
    const back = "OK, back to my drive. Find me the manual.";
    expect(threadStatusScope(["Find me the manual for AutomationDirect GS11N-20P25", back], GS10)).toBe("other");
  });
});
