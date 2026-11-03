// #5133 — "huh? thats not what i asked, i want the AMPS" got the same 8.0 A /
// code 8P0 answer back (staging, 10-27 22:07). A correction turn whose draft
// repeats the previous answer must ask one clarifying question instead.
import { describe, it, expect } from "vitest";
import { CORRECTION_REPEAT_TEXT, correctionRepeatReplacement, isCorrectionTurn, repeatsPrevious } from "./correction-turn";

const PREV =
  "The max output current for the 200-240V, 2 HP PowerFlex 4 is 8.0 A, catalog code 8P0 [1]. Check the drive nameplate to confirm the rating [2].";
const REPEAT =
  "The max output current for the 200-240V 2 HP PowerFlex 4 is 8.0 A (code 8P0) [1]. Confirm the rating on the drive nameplate [2].";
const NEW_ANSWER = "Base RPM is parameter P0.03; its default is 1750 rpm [1]. Set it to the motor nameplate speed.";

describe("isCorrectionTurn (#5133)", () => {
  it.each([
    "huh? thats not what i asked, i want the AMPS",
    "That's not what I asked",
    "not what i meant",
    "ignore that",
    "no, I meant the input current",
    "wrong question, try again",
  ])("detects %s", (m) => {
    expect(isCorrectionTurn(m)).toBe(true);
  });

  it.each(["what is the max output current", "ignore the fault light, what does F004 mean", "is that the input current?"])(
    "does not flag %s",
    (m) => {
      expect(isCorrectionTurn(m)).toBe(false);
    },
  );
});

describe("repeatsPrevious (#5133)", () => {
  it("a near-duplicate draft repeats", () => {
    expect(repeatsPrevious(PREV, REPEAT)).toBe(true);
  });
  it("a genuinely new answer does not", () => {
    expect(repeatsPrevious(PREV, NEW_ANSWER)).toBe(false);
  });
  it("citation markers alone do not make answers differ", () => {
    expect(repeatsPrevious("Output is 8.0 A [1].", "Output is 8.0 A [3].")).toBe(true);
  });
  it("a draft that only drops a banner the previous answer carried still repeats", () => {
    const banner = "Warning: lockout conflict in a step below, inspect with the equipment locked out and the bus confirmed dead first.";
    expect(repeatsPrevious(`${banner}\n\n${PREV}`, REPEAT)).toBe(true);
  });
  it("a new value is a new answer, even in mostly shared words", () => {
    expect(repeatsPrevious(PREV, "The input current for the 2 HP PowerFlex 4 is 9.6 A [1].")).toBe(false);
  });
  it("an empty side never repeats", () => {
    expect(repeatsPrevious("", REPEAT)).toBe(false);
    expect(repeatsPrevious(PREV, "")).toBe(false);
  });
});

describe("correctionRepeatReplacement (#5133)", () => {
  const history = [
    { role: "user" as const, content: "max output current?" },
    { role: "assistant" as const, content: PREV },
  ];
  it("replaces a repeat on a correction turn", () => {
    expect(correctionRepeatReplacement("huh? thats not what i asked, i want the AMPS", REPEAT, history)).toBe(
      CORRECTION_REPEAT_TEXT,
    );
  });
  it("keeps a new answer on a correction turn (control)", () => {
    expect(correctionRepeatReplacement("ignore that, base rpm default", NEW_ANSWER, history)).toBeNull();
  });
  it("keeps a repeat on an ordinary turn (control)", () => {
    expect(correctionRepeatReplacement("what is the max output current again", REPEAT, history)).toBeNull();
  });
  it("compares against the LAST assistant turn only", () => {
    const h = [...history, { role: "user" as const, content: "and base rpm?" }, { role: "assistant" as const, content: NEW_ANSWER }];
    expect(correctionRepeatReplacement("not what i asked", REPEAT, h)).toBeNull();
  });
  it("no previous answer, no replacement", () => {
    expect(correctionRepeatReplacement("ignore that", REPEAT, [])).toBeNull();
  });
  it("the clarifying text carries no citation marker", () => {
    expect(CORRECTION_REPEAT_TEXT).not.toMatch(/\[\d+\]/);
  });
});
