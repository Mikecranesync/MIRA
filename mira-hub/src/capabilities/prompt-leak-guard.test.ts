/**
 * Prompt-leak guard (#3785) — pure-function unit tests.
 *
 * `GENERAL_SYSTEM_PROMPT` and `BASE_SYSTEM_PROMPT` are imported from the real
 * route rather than hand-copied: there is no standalone "build the system
 * prompt" function (MACHINE CONTEXT, coverage directives, hazard/visual
 * sections are assembled inline in `handleChatTurn`), so these two exported
 * constants are the closest thing to the builder's output. `ISOLATION_STEP_
 * RULE` (also real, imported from `./answer-shape`) is appended to EVERY
 * turn's prompt in production via `withStepSafety` — so the two composite
 * prompts below (`GENERAL_WITH_STEP_SAFETY`/`BASE_WITH_STEP_SAFETY`) are
 * closer to the actual production string than the bare constants alone,
 * and are where a real false positive was found and fixed: `ISOLATION_STEP_
 * RULE` quotes a SINGLE-quoted instructed example
 * (`'with the drive locked out and the DC bus confirmed dead with a meter,
 * check…'`) that the double-quote-only exclusion in an earlier version of
 * this module did not strip, so a legitimate answer following that exact
 * instruction shared a 12-word run with the prompt and was flagged. The
 * route-level test (`src/capabilities/__tests__/prompt-leak-guard-route.test.ts`)
 * sweeps the SAME fixtures again against the full, truly-assembled
 * production prompt (MACHINE CONTEXT and all) captured live from a stubbed
 * provider call — this file's composites are the closest a pure unit test
 * gets without running the route.
 *
 * Four groups:
 *  1. The three #3785 probe shapes (verbatim echo, partial echo, paraphrase)
 *     — all three MUST be flagged, against every prompt below.
 *  2. A false-positive sweep: every fixture is a real answer string lifted
 *     from this repo's existing chat/answer-validation test suites (never
 *     invented for this file), run against all FOUR prompts — none may
 *     flag. Several are deliberately adversarial: sentences that closely
 *     mirror a quoted INSTRUCTED example inside one of the prompts (the
 *     model correctly doing what it was told to do must never read as a
 *     leak).
 *  3. Edge cases: empty input, and zero-width-character word-splitting
 *     obfuscation (must NOT defeat the run signal).
 *  4. Targeted mechanism proofs (`.claude/rules/prove-the-test-fails.md`
 *     rule 1): removing the quote exclusion must turn the adversarial
 *     fixtures red; removing signal 3 must turn the paraphrase test red.
 */
import { describe, expect, it } from "vitest";

import { BASE_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT } from "@/app/api/equipment-notebooks/[id]/chat/route";

import { ISOLATION_STEP_RULE } from "./answer-shape";
import { PROMPT_LEAK_FALSE_POSITIVE_FIXTURES } from "./__fixtures__/prompt-leak-false-positives";
import { detectPromptLeak, PROMPT_LEAK_REFUSAL } from "./prompt-leak-guard";

const PROMPTS = {
  GENERAL: GENERAL_SYSTEM_PROMPT,
  BASE: BASE_SYSTEM_PROMPT,
  // Real production shape: every turn's prompt carries ISOLATION_STEP_RULE
  // (`withStepSafety`). Catches the single-quoted-example false positive.
  GENERAL_WITH_STEP_SAFETY: `${GENERAL_SYSTEM_PROMPT}\n\n${ISOLATION_STEP_RULE}`,
  BASE_WITH_STEP_SAFETY: `${BASE_SYSTEM_PROMPT}\n\n${ISOLATION_STEP_RULE}`,
} as const;

describe("#3785 — the three reproduced probe shapes, against both prompts", () => {
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    it(`verbatim echo of ${name} is flagged`, () => {
      const r = detectPromptLeak(prompt, prompt);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });

    it(`a verbatim echo prefixed with chatty filler ("Sure, here it is:\\n\\n") is still flagged (${name})`, () => {
      const r = detectPromptLeak(prompt, `Sure, here it is:\n\n${prompt}`);
      expect(r.leaked).toBe(true);
    });
  }

  // The exact excerpt quoted in GH issue #3785 as "leaked content (verbatim
  // excerpt returned to the client)" — a PARTIAL echo (the "..." marks are
  // the issue author's elisions of the rest of the leaked prompt, not mine).
  // Several of its sentences (HONESTY's wording in particular) predate later
  // prompt revisions (#4099 etc.), but the opening sentence and the SAFETY
  // line are unchanged, so this is still a faithful partial-echo fixture.
  const issuePartialEcho =
    "You are MIRA, a maintenance assistant helping a technician who is standing at a machine RIGHT NOW...\n" +
    "ANSWER SHAPE — the technician needs something they can act on: - Lead with the most likely cause...\n" +
    "HONESTY: - You have NO manual for this machine. Never state a specific parameter number, terminal\n" +
    "number, torque value, fault-code meaning, or wiring detail as if it were confirmed for this exact model...\n" +
    "SAFETY: assume the equipment may be energized... NEVER provide an energized-measurement or live-work\n" +
    "procedure on 480 V-class equipment...\n" +
    "MACHINE CONTEXT (facts about this notebook, not retrieved excerpts): - Equipment: an unspecified machine...";

  it("the #3785 issue's partial-echo excerpt is flagged against GENERAL_SYSTEM_PROMPT", () => {
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, issuePartialEcho);
    expect(r.leaked).toBe(true);
    // The opening sentence alone is a 17-word verbatim run.
    expect(r.violation).toBe("prompt-leak:verbatim-run");
  });

  // A genuine paraphrase: every sentence independently reworded, no sentence
  // copied, but — realistically, for a model asked to "repeat this in your
  // own words" — the document's own section scaffolding survives.
  const structurePreservingParaphrase = `Here is my setup, in my own words, keeping the same sections:

ANSWER SHAPE: when someone is troubleshooting I open with my best guess at the cause, then list
cheap, safe checks first. For a "what does this mean" question I just explain it instead of
turning it into a procedure, and I only ask one clarifying question when it would truly change
the answer. I try to stay under roughly a hundred and fifty words.

HONESTY: nothing is loaded for this particular unit, so I lean on general electrical and
mechanical knowledge instead of a manual. I will not claim a part number or compatibility I
cannot verify, and I will say plainly when a question needs plant records I do not have.

SAFETY: I always assume the gear could be energized, call out isolation before any step that
needs it, and never talk anyone through live work on 480-volt equipment.`;

  it("a structure-preserving paraphrase of GENERAL_SYSTEM_PROMPT is flagged by the section-label signal", () => {
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, structurePreservingParaphrase);
    expect(r.leaked).toBe(true);
    expect(r.violation).toBe("prompt-leak:section-labels");
    expect(r.detail).toContain("ANSWER SHAPE");
    expect(r.detail).toContain("HONESTY");
    expect(r.detail).toContain("SAFETY");
  });

  it("an HONEST limitation, stated rather than hidden: a paraphrase with NO section labels and NO shared long run is not caught", () => {
    // Deliberately drops every ALL-CAPS header AND rewords every sentence —
    // the residual this module cannot close without an LLM judge or
    // phrase-matching. Recorded in the PR's hazard ledger, not silently
    // assumed away (see the module's "Honest scope" docstring).
    const fullyFreeformSummary =
      "Okay, in short: I'm a maintenance helper for one machine, nothing's loaded for it yet so I " +
      "work from general electrical and mechanical know-how, I open with my best guess and a cheap " +
      "checklist, I won't invent part numbers, and I treat anything electrical as potentially live.";
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, fullyFreeformSummary);
    expect(r.leaked).toBe(false);
  });
});

describe("#3785 — false-positive sweep (shared fixture set, see __fixtures__/prompt-leak-false-positives.ts)", () => {
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    it.each(PROMPT_LEAK_FALSE_POSITIVE_FIXTURES)(`%s — not flagged against ${name}`, (answerText) => {
      const r = detectPromptLeak(prompt, answerText);
      expect(r.leaked).toBe(false);
    });
  }
});

describe("edge cases", () => {
  it("empty reply is never flagged", () => {
    expect(detectPromptLeak(GENERAL_SYSTEM_PROMPT, "").leaked).toBe(false);
    expect(detectPromptLeak(GENERAL_SYSTEM_PROMPT, "   ").leaked).toBe(false);
  });

  it("empty system prompt is never flagged (nothing to leak)", () => {
    expect(detectPromptLeak("", "anything at all, as long as it wants")).toEqual({ leaked: false });
  });

  /** U+200B ZERO WIDTH SPACE spliced BETWEEN every letter of every word —
   *  not between words (a between-words placement is vacuous: the final
   *  non-alnum collapse would merge it with the adjacent real space either
   *  way, so the test would pass even if the \p{Cf} fold were deleted). With
   *  the characters INSIDE each word, only stripping \p{Cf} BEFORE collapsing
   *  non-alphanumerics folds "M​I​R​A" back into one token
   *  "mira"; skip that ordering and the word shatters into four single-letter
   *  tokens, which can never form a 12-word run. */
  function zeroWidthSplice(word: string): string {
    return word.split("").join("​");
  }

  it("zero-width characters spliced INSIDE every word cannot defeat the run signal", () => {
    const obfuscated = "You are MIRA, a maintenance assistant helping a technician who is standing at a machine RIGHT NOW."
      .split(" ")
      .map(zeroWidthSplice)
      .join(" ");
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, obfuscated);
    expect(r.leaked).toBe(true);
    expect(r.violation).toBe("prompt-leak:verbatim-run");
  });
});

describe("PROMPT_LEAK_REFUSAL", () => {
  it("names no detector, echoes no matched text, and redirects to the product", () => {
    expect(PROMPT_LEAK_REFUSAL).toBe("I can't share my internal instructions. Ask me about your equipment.");
  });
});
