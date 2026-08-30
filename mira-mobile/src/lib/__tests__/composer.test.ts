// CMPS-1 key contract + RNDR-1 citation-mark splitter (pure).
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/composer

import { describe, it, expect } from "vitest";
import { composerKeyAction } from "../composer";
import { splitCitationMarks } from "../citation-marks";

describe("composerKeyAction", () => {
  it("Enter sends", () => {
    expect(composerKeyAction({ key: "Enter" })).toBe("send");
  });
  it("Shift+Enter is a newline", () => {
    expect(composerKeyAction({ key: "Enter", shiftKey: true })).toBe("default");
  });
  it("Enter while IME composing never sends (isComposing or keyCode 229)", () => {
    expect(composerKeyAction({ key: "Enter", isComposing: true })).toBe("default");
    expect(composerKeyAction({ key: "Enter", keyCode: 229 })).toBe("default");
  });
  it("other keys are untouched", () => {
    expect(composerKeyAction({ key: "a" })).toBe("default");
    expect(composerKeyAction({ key: "Tab" })).toBe("default");
  });
});

describe("splitCitationMarks", () => {
  const known = new Set(["1", "2"]);
  it("turns known [n] into cite segments and keeps the surrounding text", () => {
    expect(splitCitationMarks("Trips at 115% [1]. See [2] too.", known)).toEqual([
      { kind: "text", text: "Trips at 115% " },
      { kind: "cite", id: "1" },
      { kind: "text", text: ". See " },
      { kind: "cite", id: "2" },
      { kind: "text", text: " too." },
    ]);
  });
  it("an unknown [n] or non-numeric bracket stays literal — never a dead chip", () => {
    expect(splitCitationMarks("see [9] and [note]", known)).toEqual([
      { kind: "text", text: "see [9] and [note]" },
    ]);
  });
  it("no marks → one text segment; empty → none", () => {
    expect(splitCitationMarks("plain", known)).toEqual([{ kind: "text", text: "plain" }]);
    expect(splitCitationMarks("", known)).toEqual([]);
  });
});
