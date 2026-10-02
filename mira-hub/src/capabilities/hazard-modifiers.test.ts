/**
 * Shared ConText-style modifier layer — fixed proof table (Codex rounds 1–4 on
 * #4200 plus the scope-termination cases), run through the real validateAnswer.
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";
import { governingModifier } from "./hazard-modifiers";

const Q = "Can I reset the E-12 fault and inspect the seal bar while the machine is still energized?";
const check = (answerText: string) =>
  validateAnswer({ answerText, question: Q, general: false, served: true, refused: false });

/** Cancelled by a governing modifier: must be released. */
export const MUST_RELEASE: Record<string, string> = {
  // Spec cases.
  NEVER_ASSUME_SAFE: "Never assume energized work is safe.",
  DO_NOT_ASSUME_APPROVED: "Do not assume energized work is approved.",
  DONT_THINK_SAFE: "Don't think energized work is safe.",
  // Codex R3 F5 and R4 F7 (caution framing across rules).
  NO_ENERGIZED_WORK: "No energized work is approved on this machine.",
  NEVER_ASSUME_LIVE: "Never assume the seal bar can be inspected live.",
  NOT_ALL_SAFE: "Not all energized work is safe.",
  NEVER_ASSUME_RUNNING: "Never assume resetting E-12 on a running TS-440 is fine.",
  // Hypothetical: an attributed false belief.
  MYTH: "It is a common myth that energized work is safe on this sealer.",
  SOME_PEOPLE: "Some technicians think the seal bar can be inspected live; it cannot.",
};

/** Affirmative, or cancellation ended by a terminator: must stay flagged. */
export const MUST_FLAG: Record<string, string> = {
  AFFIRM_SAFE: "Energized work is safe.",
  AFFIRM_APPROVED: "Energized work is approved.",
  BUT_TERMINATES: "Never assume energized work is safe, but energized work is approved here.",
  HOWEVER_TERMINATES: "Never assume the guard is closed; however, energized reset is approved for this model.",
  SEMICOLON_TERMINATES: "Do not assume the bar is cool; energized work is approved on this unit.",
  COLON_TERMINATES: "Never assume otherwise: the seal bar can be inspected live.",
  AND_TERMINATES: "Don't think about it and energized reset is approved here.",
  // The six unsafe variants pinned during #4200 R3.
  V1: "Not all energized work is safe, but energized reset is approved for the TS-440.",
  V2: "No lockout is needed; energized work is approved on this machine.",
  V3: "There is no doubt: energized reset is approved [1].",
  V4: "Never assume otherwise; the seal bar can be inspected live [1].",
  V5: "Leave the machine on and open the seal bar guard.",
  V6: "Leave the machine on, open the HMI, then reset E-12 and inspect the seal bar.",
  // Pseudo-triggers and pronoun-led clauses are not negations.
  NO_DOUBT: "No doubt energized reset is approved for this model.",
  NO_YOU_CAN: "No you can reset it while the machine is energized.",
  WHETHER_OR_NOT: "Whether or not it is safe to reset while energized, go ahead and reset it while energized.",
  DONT_THINK_TWICE: "Don't think twice — the seal bar can be inspected live.",
};

describe("hazard modifier layer — proof table", () => {
  for (const [id, text] of Object.entries(MUST_RELEASE)) {
    it(`${id} is released`, () => expect(check(text)).toEqual({ ok: true }));
  }
  for (const [id, text] of Object.entries(MUST_FLAG)) {
    it(`${id} stays flagged`, () => expect(check(text).ok).toBe(false));
  }
});

describe("governingModifier — scope primitives", () => {
  const at = (text: string, target: string) => governingModifier(text, text.indexOf(target));
  it("adjacent negation governs the head it touches", () => {
    expect(at("No energized work is approved.", "energized")).toMatchObject({ type: "negated" });
  });
  it("adjacent negation does not reach past one word", () => {
    expect(at("No lockout energized work is approved.", "energized")).toBeNull();
  });
  it("caution window governs the complement", () => {
    expect(at("Never assume the seal bar can be inspected live.", "can")).toMatchObject({ type: "caution" });
  });
  it("every terminator ends caution scope", () => {
    for (const t of [",", ";", ":", ".", " but", " however", " and", " then", " —"]) {
      expect(at(`Never assume the bar is cool${t} energized work is approved.`, "energized")).toBeNull();
    }
  });
  it("the caution window is bounded", () => {
    const far = "Never assume one two three four five six seven eight nine energized work is approved.";
    expect(at(far, "energized")).toBeNull();
  });
});
