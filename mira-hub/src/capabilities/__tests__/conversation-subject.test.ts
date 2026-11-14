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
const RETURNS: readonly string[] = [
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
];
const NOT_RETURNS: readonly string[] = [
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
];
const CANCELLED_NEXT_CLAUSE: readonly string[] = [
  "go back to mine. No, stay on this one. What is its rated input current?",
  "ok back to mine, actually wait, what about its VT current",
  "back to mine. never mind, same thing?",
  "let's go back to my drive, scratch that, what is its frame size",
  "back to mine\nhold on, stay on this one",
  // Codex r4 on #5464 (F1): consecutive separators leave an empty clause between them;
  // the reversal is in the next NON-EMPTY clause.
  "go back to mine.\nNo, stay on this one. What is its rated input current?",
  "go back to mine... No, stay on this one. What is its rated input current?",
  "ok back to mine -- actually wait, what about its VT current",
];
const STILL_RETURN_NEXT_IS_QUESTION: readonly string[] = [
  "go back to mine. what is its VT current",
  "ok back to mine, now what frame size is it",
  "back to mine. not sure of the exact spec, what is its VT current",
  "go back to mine...\nwhat is its VT current",
];
const QUESTION_MARK_IN_RUN: readonly string[] = [
  "ok back to mine...? What is its rated input current?",
  "back to mine!? what is its VT current",
  "back to mine.? what is its VT current",
  "back to mine!!? what is its VT current",
  "ok back to mine...\n? what is its VT current",
  "back to mine, ? what is its VT current",
  "ok back to mine...?",
];
const QUESTION_MARK_LATER: readonly string[] = [
  "back to mine! what is its VT current?",
  "ok back to mine... what is its VT current?",
  "back to mine!!\nwhat frame size is it?",
];

describe("whether a question returns to the technician's own unit", () => {
  it.each(RETURNS)("is a return: %s", (q) => {
    expect(returnsToRecord(q)).toBe(true);
  });

  it.each(NOT_RETURNS)("is not a return: %s", (q) => {
    expect(returnsToRecord(q)).toBe(false);
  });

  // Codex r3 on #5464 (F1), Mike B 2026-11-13: a reversal opening the NEXT clause cancels the return.
  it.each(CANCELLED_NEXT_CLAUSE)("is not a return (cancelled in the next clause): %s", (q) => {
    expect(returnsToRecord(q)).toBe(false);
  });

  it.each(STILL_RETURN_NEXT_IS_QUESTION)("is still a return (the next clause is a question, not a reversal): %s", (q) => {
    expect(returnsToRecord(q)).toBe(true);
  });

  // #5467 (Codex r5 on #5464, F1): a "?" ANYWHERE in the run of separators after the phrase makes it a
  // question, not a return. The run is read whole, so no ordering of . ! ? , or line breaks hides it.
  it.each(QUESTION_MARK_IN_RUN)("is not a return (a question mark inside the separator run): %s", (q) => {
    expect(returnsToRecord(q)).toBe(false);
  });

  it.each(QUESTION_MARK_LATER)("is still a return (the only question mark ends a LATER clause): %s", (q) => {
    expect(returnsToRecord(q)).toBe(true);
  });

  it("accepted residue: a reversal TWO clauses later is not detected (the sibling is re-named by typing it)", () => {
    expect(returnsToRecord("go back to mine. what is its VT current. no wait, stay on this one")).toBe(true);
  });
});

// #5485 (independent campaign, Unicode-consistency oracle): what a phone keyboard types must read the same
// as its plain-ASCII spelling. iOS smart punctuation turns "..." into one ellipsis character and "--" into an
// em dash with no spaces; Gboard types an en dash; both type a curly apostrophe. Mike chose A (2026-11-13):
// one shared clean-up, not another single-spelling patch, so the proof is every case above in every spelling.
const ALL_CASES: readonly string[] = [
  ...RETURNS,
  ...NOT_RETURNS,
  ...CANCELLED_NEXT_CLAUSE,
  ...STILL_RETURN_NEXT_IS_QUESTION,
  ...QUESTION_MARK_IN_RUN,
  ...QUESTION_MARK_LATER,
];
const PHONE_SPELLINGS: ReadonlyArray<[string, (q: string) => string]> = [
  ["one-character ellipsis (U+2026)", (q) => q.replaceAll("...", "\u2026")],
  ["em dash, no spaces (U+2014)", (q) => q.replace(/ -{1,2} /g, "\u2014")],
  ["em dash, spaced (U+2014)", (q) => q.replace(/ -{1,2} /g, " \u2014 ")],
  ["en dash, no spaces (U+2013)", (q) => q.replace(/ -{1,2} /g, "\u2013")],
  ["two hyphens, no spaces", (q) => q.replace(/ -{1,2} /g, "--")],
  ["curly apostrophe (U+2019)", (q) => q.replaceAll("'", "\u2019")],
  ["no-break spaces (U+00A0)", (q) => q.replaceAll(" ", "\u00A0")],
  ["zero-width space inside a word (U+200B)", (q) => q.replace(/back/gi, (w) => `${w[0]}\u200B${w.slice(1)}`)],
];
const SPELLING_ROWS = PHONE_SPELLINGS.flatMap(([how, spell]) =>
  ALL_CASES.map((q) => [how, q, spell(q)] as const).filter(([, q, typed]) => typed !== q),
);

describe("#5485: a phone's spelling reads the same as plain typing", () => {
  it("every phone spelling changes at least one case (the table is not vacuous)", () => {
    for (const [how] of PHONE_SPELLINGS) expect(SPELLING_ROWS.some(([h]) => h === how), how).toBe(true);
  });

  it.each(SPELLING_ROWS)("%s: %j", (_how, ascii, typed) => {
    expect(returnsToRecord(typed)).toBe(returnsToRecord(ascii));
  });

  // The two shapes the campaign reported (F04, F06), written out; and a dash run before a plain
  // follow-up is still a return (control for Codex r1 on #5490).
  it.each([
    "back to mine\u2014- what frame size is it",
    "back to mine - - what frame size is it",
    "ok back to mine\u2026 what frame size is it",
    "ok back to mine\u2014what frame size is it",
    "let\u2019s go back to mine, what is its rated input current?",
    // #5493 (Codex r2 on #5490, F2): a mixed dash run BEFORE the phrase is punctuation too.
    "ok\u2014-back to mine, what frame size is it",
    "ok\u2013-back to mine, what frame size is it",
    "ok - -back to mine, what frame size is it",
    "ok -\u2014back to mine, what frame size is it",
  ])("is a return: %j", (q) => {
    expect(returnsToRecord(q)).toBe(true);
  });

  it.each([
    // A question mark after the ellipsis character is still a question (#5467 controls).
    "ok back to mine\u2026?",
    "ok back to mine\u2026? What is its rated input current?",
    // A reversal after a dash still cancels.
    "ok back to mine\u2014actually wait, what about its VT current",
    // Codex r1 on #5490 (F1): punctuation with no words between two separators is part of the
    // separator run, not a clause. A mixed dash run hides neither the "?" nor the reversal after it.
    "back to mine\u2014-? What is its rated input current?",
    "back to mine\u2014-actually wait, what is its VT current",
    "back to mine\u2013-? What is its rated input current?",
    "back to mine\u2013-actually wait, what is its VT current",
    "back to mine - -? What is its rated input current?",
    "back to mine. -actually wait, what is its VT current",
    "back to mine, -- no, stay on this one",
    // A single hyphen-equivalent is a hyphen, not a clause break: "mine-ish" is not a return, in any spelling.
    "back to mine\u2011ish what frame size is it",
    "back to mine-ish what frame size is it",
    // #5493 controls: only punctuation is dropped before the phrase. A word there still has to be a
    // connective, and the "?" and reversal rules after the phrase still hold behind a dash run.
    "ok\u2014-not back to mine, what frame size is it",
    "ok\u2014-x-back to mine, what frame size is it",
    // Only hyphen tokens are dropped: a full-width question mark beside the phrase still fails closed.
    "ok\u2014-back to mine \uFF1F",
    "ok\u2014-back to mine\u2014-? What is its rated input current?",
    "ok\u2014-back to mine\u2014-actually wait, what is its VT current",
    "ok\u2014-back to mine what frame size is it",
    // Out of scope, still fails closed: full-width punctuation is not read as a clause break.
    "back to mine\uFF0Cwhat frame size is it",
    "back to mine\uFF1F",
  ])("is not a return: %j", (q) => {
    expect(returnsToRecord(q)).toBe(false);
  });
});
