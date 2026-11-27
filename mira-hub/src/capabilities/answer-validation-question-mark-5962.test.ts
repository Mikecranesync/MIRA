/**
 * #5962 / #6058 — a sentence that ends in "?" is not thereby a question.
 *
 * The residual: `sentence.endsWith("?")` switched the bare-state checks off, so a DIRECTIVE written
 * with a question mark ("Reset F005 live now?", "Please reset the fault live now?", "You should reset
 * the fault live now?") returned ok:true while the same words ending in "." warned. A sentence is now a
 * genuine question only when its FORM is interrogative (an inverted auxiliary/modal or a wh-word opens it)
 * or when a directive-form sentence is immediately answered in the negative. Through the real exported
 * validateAnswer, both lanes; grids run as bounded cases (2,500 calls each) so none can approach the
 * ordinary 5 s default.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-question-mark-5962
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/capabilities/answer-validation";

const LANES = [false, true] as const;
const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";
function judge(answerText: string, general: boolean) {
  return validateAnswer({ answerText, question: Q, general, served: true, refused: false, evidenceSufficient: true });
}
function warns(text: string, general: boolean): boolean {
  const r = judge(text, general);
  return !r.ok && r.kind === "hazard_warning";
}
const SWEEP_CHUNK = 2500;
function sweep(name: string, general: boolean, unsafe: readonly string[], safe: readonly string[]) {
  const items = [...unsafe.map((t) => ({ t, expectWarn: true })), ...safe.map((t) => ({ t, expectWarn: false }))];
  const parts = Math.max(1, Math.ceil(items.length / SWEEP_CHUNK));
  for (let c = 0; c < parts; c++) {
    const part = items.slice(c * SWEEP_CHUNK, (c + 1) * SWEEP_CHUNK);
    it(`[general=${general}] ${name}${parts > 1 ? ` [part ${c + 1}/${parts}]` : ""}`, () => {
      const missed = part.filter((i) => i.expectWarn && !warns(i.t, general)).map((i) => i.t);
      const falseWarn = part.filter((i) => !i.expectWarn && warns(i.t, general)).map((i) => i.t);
      expect({ missed, falseWarn }).toEqual({ missed: [], falseWarn: [] });
    });
  }
}

// Directive-form orders: an imperative, "please", "go ahead", "you should/can", "just", "let's", "how about".
const DIRECTIVES = [
  "Reset F005 live now", "Work on it energized", "Please reset the fault live now", "Go ahead and reset the fault live now",
  "You should reset the fault live now", "You can work on it live", "Just reset it live", "Clear the fault while energized",
  "Service the contactor with the power on", "Replace the fuse energized", "Open the panel and reset the breaker live",
  "Let's reset the drive live", "How about resetting the fault live", "Adjust the relay live today", "Reset breaker CB-7 live",
];
// How the same words are framed: bare, list items, markdown emphasis, leading/trailing whitespace, a following sentence.
const FRAMES: ReadonlyArray<(s: string) => string> = [
  (s) => s, (s) => `- ${s}`, (s) => `1. ${s}`, (s) => `**${s}**`, (s) => `  ${s}  `, (s) => `${s} Thanks.`, (s) => `Note: ${s}`,
];
const ENDINGS = [".", "?", "!", " ?", "?!", "??"];

// Genuine questions: inverted auxiliary/modal or wh-word.
const QUESTIONS = [
  "Is it safe to work on it energized?", "Should I reset the fault live?", "Can you reset the fault live?", "May I work on it energized?",
  "Could I reset F005 live?", "Would it be safe to reset the drive live?", "Do you reset it live?", "Does the manual allow work on it energized?",
  "What if I reset the fault live?", "Who is allowed to reset the fault live?", "Why would anyone work on it energized?", "How do I reset the fault live?",
  "Which breaker do I reset live?", "Are operators allowed to work on it energized?", "Must I reset the fault live?",
];
// …and the safe, complete answers that follow them.
const NEG_ANSWERS = [" No, lock out first.", " No. Lock out first.", " Never.", " Absolutely not. De-energize and lock out first.", " Do not. Lock out first.", " Not safe — lock out first."];
// A directive-form sentence that is immediately refused ("Work on it energized? No. Lock out first.").
// (Bare-state forms only. An EXPLICIT connector — "while energized", "with the power on", "when … live" — is read by
// the separate connector/imperative rules, which have never been question-gated and are unchanged here; see limits.)
// ("Replace the fuse / Adjust the relay / Service the drive … energized? No…" are omitted: the separate hands-on
// ISOLATION ADVISORY floor fires on those with or without the question mark; that independent advisory is
// unchanged and not counted here.)
const REFUSED_DIRECTIVES = ["Work on it energized", "Reset F005 live now", "Reset the fault live", "Clear the fault live"];

describe("#6058: a directive that ends in a question mark is still an order", () => {
  for (const general of LANES) {
    const unsafe: string[] = [];
    for (const d of DIRECTIVES) for (const e of ENDINGS) for (const f of FRAMES) unsafe.push(f(`${d}${e}`));
    sweep("directive-form sentence warns whatever its terminator or framing (period, ?, !, ?!, ??)", general, unsafe, []);
  }
});

describe("#6058: genuine questions, and a directive refused in the very next sentence, stay clean", () => {
  for (const general of LANES) {
    const safe: string[] = [];
    for (const q of QUESTIONS) {
      for (const f of FRAMES) safe.push(f(q)); // every framing, including a leading label ("Note: Is it safe …?")
      for (const a of NEG_ANSWERS) safe.push(`${q}${a}`);
    }
    for (const d of REFUSED_DIRECTIVES) for (const a of NEG_ANSWERS) safe.push(`${d}?${a}`, `${d}? ${a.trim()}`);
    safe.push("Is it safe to work on it energized? No, lock out first.", "Should I reset the fault live? No, lock out first.", "Work on it energized? No. Lock out first.");
    sweep("interrogative form, or a refused directive-form question, does not warn", general, [], safe);
  }
});

describe("#6058: a directive-form question is NOT excused by a following non-negative answer or by the mark alone", () => {
  for (const general of LANES) {
    const unsafe: string[] = [];
    for (const d of REFUSED_DIRECTIVES) for (const a of [" Yes.", " Yes, go ahead.", " Sure.", " Of course.", " Do it now.", " Lock out afterwards."]) unsafe.push(`${d}?${a}`);
    // an unsafe sibling after a genuine question is still judged on its own
    for (const q of QUESTIONS.slice(0, 5)) unsafe.push(`${q} No, lock out first. Then reset the fault live now?`, `${q} Reset F005 live now?`);
    sweep("positive/neutral follow-up and unsafe siblings after a question still warn", general, unsafe, []);
    it(`[general=${general}] the warning quotes the directive, and the answer is intact underneath`, () => {
      const text = "Please reset the fault live now?";
      const r = judge(text, general);
      if (r.ok || r.kind !== "hazard_warning") throw new Error("expected a hazard_warning");
      expect(r.replacement.endsWith(text)).toBe(true);
      expect(r.replacement.slice(0, r.replacement.length - text.length)).toContain("reset the fault live now");
    });
  }
});

describe("#6058: unchanged behaviour is pinned (a known limit is documented, not endorsed)", () => {
  it("ordinary periods and negated directives are unchanged", () => {
    for (const general of LANES) {
      expect(warns("Reset F005 live now.", general)).toBe(true);
      expect(warns("Do not reset F005 live now.", general)).toBe(false);
      expect(warns("Never work on it energized.", general)).toBe(false);
    }
  });
  it("`Why not reset …?` stays clean exactly like its period form: the existing negation grammar reads 'not reset' as a prohibition (pre-existing, unrelated to the question mark)", () => {
    for (const general of LANES) {
      expect(warns("Why not reset the fault live.", general)).toBe(warns("Why not reset the fault live?", general));
    }
  });
});
