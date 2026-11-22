/** The matrix generator must enumerate exactly, or the #5670 coverage matrix proves nothing. */
import { describe, expect, it } from "vitest";
import { regexLanguage } from "./regex-language";

describe("regexLanguage", () => {
  it("enumerates groups, alternation, optional parts and classes exactly", () => {
    expect(regexLanguage("(?:turn|shut)(?:s|ing)?").sort()).toEqual(["shut", "shuting", "shuts", "turn", "turning", "turns"]);
    // Whitespace folds to one space, so "e  stop" and "e stop" are one string: 10 distinct, not 12.
    expect(regexLanguage("e\\s?[-.]?\\s?stop").sort()).toEqual(
      ["e - stop", "e -stop", "e . stop", "e .stop", "e stop", "e- stop", "e-stop", "e. stop", "e.stop", "estop"],
    );
    expect(regexLanguage("light[-\\s]curtains?").sort()).toEqual(["light curtain", "light curtains", "light-curtain", "light-curtains"]);
    expect(regexLanguage("out\\s+of\\s+(?:service|order)").sort()).toEqual(["out of order", "out of service"]);
    expect(regexLanguage("(?:[a-z-]+\\s+)?interlocks?", ["door"]).sort()).toEqual(["door interlock", "door interlocks", "interlock", "interlocks"]);
    expect(regexLanguage("w/?").sort()).toEqual(["w", "w/"]);
  });

  it("refuses syntax it cannot enumerate, so a word list cannot silently outgrow the matrix", () => {
    expect(() => regexLanguage("a{1,2}")).toThrow(/counted repeat/);
    expect(() => regexLanguage("(a)")).toThrow(/non-capturing/);
    expect(() => regexLanguage("a(?=b)")).toThrow();
    expect(() => regexLanguage("a.b")).toThrow(/metacharacter/);
    expect(() => regexLanguage("[a-z]")).toThrow(/open class/);
  });
});
