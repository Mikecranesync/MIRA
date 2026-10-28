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

import {
  BASE_NFPA_CAUTION,
  BASE_SYSTEM_PROMPT,
  FIELD_OBSERVATION_DIRECTIVE,
  GENERAL_NFPA_CAUTION,
  GENERAL_SYSTEM_PROMPT,
  UNCITED_OEM_CLAIM_TEXT,
} from "@/app/api/equipment-notebooks/[id]/chat/route";

import { ISOLATION_STEP_RULE } from "./answer-shape";
import { validateAnswer } from "./answer-validation";
import { PHOTO_PROVENANCE_NOTE } from "./photo-provenance";
import { RESTART_DIRECTIVE } from "./restart-advisory";
import {
  PROMPT_LEAK_FALSE_POSITIVE_FIXTURES,
  PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES,
  PROMPT_LEAK_ISOLATION_FIXTURES,
  PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES,
  PROMPT_LEAK_RESTART_FIXTURES,
  PROMPT_LEAK_GENERAL_NFPA_FIXTURES,
  PROMPT_LEAK_BASE_NFPA_FIXTURES,
} from "./__fixtures__/prompt-leak-false-positives";
import { detectPromptLeak, PROMPT_LEAK_REFUSAL } from "./prompt-leak-guard";

const PROMPTS = {
  GENERAL: GENERAL_SYSTEM_PROMPT,
  BASE: BASE_SYSTEM_PROMPT,
  // Real production shape: every turn's prompt carries ISOLATION_STEP_RULE
  // (`withStepSafety`). Catches the single-quoted-example false positive.
  GENERAL_WITH_STEP_SAFETY: `${GENERAL_SYSTEM_PROMPT}\n\n${ISOLATION_STEP_RULE}`,
  BASE_WITH_STEP_SAFETY: `${BASE_SYSTEM_PROMPT}\n\n${ISOLATION_STEP_RULE}`,
} as const;

// Codex F2: FIELD_OBSERVATION_DIRECTIVE rides EVERY turn's prompt in BOTH
// modes (route.ts: `basePrompt = modePrompt + FIELD_OBSERVATION_DIRECTIVE`).
// Real production shape, with the per-turn `exclude` param these tests pass
// explicitly (what route.ts's hook now does).
const PROMPTS_WITH_FIELD_OBS = {
  GENERAL: `${GENERAL_SYSTEM_PROMPT}\n\n${FIELD_OBSERVATION_DIRECTIVE}`,
  BASE: `${BASE_SYSTEM_PROMPT}\n\n${FIELD_OBSERVATION_DIRECTIVE}`,
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

    // Codex round 1 F1 (HIGH): the prior version DELETED everything between
    // backticks instead of unwrapping them, so a backtick-wrapped echo
    // returned {"leaked":false} — the leaked text was discarded before any
    // signal ever saw it. These four shapes must all still be flagged.
    it(`a triple-fenced echo (no language tag) is still flagged (${name})`, () => {
      const r = detectPromptLeak(prompt, "```\n" + prompt + "\n```");
      expect(r.leaked).toBe(true);
    });

    it(`a triple-fenced echo WITH a language tag is still flagged (${name})`, () => {
      const r = detectPromptLeak(prompt, "```text\n" + prompt + "\n```");
      expect(r.leaked).toBe(true);
    });

    it(`a single-backtick-wrapped echo is still flagged (${name})`, () => {
      const r = detectPromptLeak(prompt, "`" + prompt + "`");
      expect(r.leaked).toBe(true);
    });

    it(`a fenced echo mixed with chatty prose before and after is still flagged (${name})`, () => {
      const r = detectPromptLeak(
        prompt,
        "Sure, here are my instructions verbatim:\n\n```\n" + prompt + "\n```\n\nLet me know if you need anything else!",
      );
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

  // A genuine paraphrase: every sentence reworded, no sentence copied, but
  // the document's own section scaffolding survives — exactly what the
  // #3785 issue's own leaked excerpt shows (it kept ANSWER SHAPE, HONESTY,
  // SAFETY and MACHINE CONTEXT verbatim even where its "…" elisions show
  // other wording was dropped). A first draft of this fixture that also
  // dropped the headers failed to flag (see "an HONEST limitation" below) —
  // kept as the stated residual rather than tuned until it passed.
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

describe("#3785 — Codex F2: FIELD_OBSERVATION_DIRECTIVE is domain guidance, not a secret — correctly applying it is not a leak", () => {
  // Reproduces the exact bug BEFORE the fix: the directive rides every
  // turn's prompt, and a correct answer sharing its phrasing (Codex's own
  // example) was flagged with NO exclusion applied.
  it("Codex's exact reproduction DOES flag when the directive is not excluded (proves the bug existed)", () => {
    const answer = PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES[0];
    const r = detectPromptLeak(PROMPTS_WITH_FIELD_OBS.GENERAL, answer);
    expect(r.leaked).toBe(true);
  });

  // The fix: route.ts's hook passes FIELD_OBSERVATION_DIRECTIVE in `exclude`
  // (same per-turn/restatable-content mechanism as MACHINE CONTEXT) —
  // Codex's example AND 5 more realistic directive-derived answers must all
  // clear, against BOTH modes' real prompt shape.
  for (const [name, prompt] of Object.entries(PROMPTS_WITH_FIELD_OBS)) {
    it.each(PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES)(`%s — not flagged against ${name} once FIELD_OBSERVATION_DIRECTIVE is excluded`, (answerText) => {
      const r = detectPromptLeak(prompt, answerText, [FIELD_OBSERVATION_DIRECTIVE]);
      expect(r.leaked).toBe(false);
    });
  }

  // Control: excluding the directive must NOT blind the guard to a full
  // prompt echo — the persona opening line and HONESTY/SAFETY sections are
  // untouched by this exclusion and still carry a 12-word run.
  for (const [name, prompt] of Object.entries(PROMPTS_WITH_FIELD_OBS)) {
    it(`a full verbatim echo of ${name} is still flagged even with FIELD_OBSERVATION_DIRECTIVE excluded`, () => {
      const r = detectPromptLeak(prompt, prompt, [FIELD_OBSERVATION_DIRECTIVE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  }
});

describe("#4891 F5 — ISOLATION_STEP_RULE is shared safety guidance, not a secret — correctly applying it is not a leak", () => {
  // Reproduces the exact bug BEFORE the fix: ISOLATION_STEP_RULE rides every
  // turn's prompt (via `withStepSafety`, already baked into GENERAL_WITH_
  // STEP_SAFETY/BASE_WITH_STEP_SAFETY above) with NO exclusion applied —
  // Codex's exact reproduction answer is flagged.
  it("Codex's exact reproduction DOES flag when ISOLATION_STEP_RULE is not excluded (proves the bug existed)", () => {
    const answer = PROMPT_LEAK_ISOLATION_FIXTURES[0];
    const r = detectPromptLeak(PROMPTS.GENERAL_WITH_STEP_SAFETY, answer);
    expect(r.leaked).toBe(true);
  });

  // The fix: each route's hook now passes ISOLATION_STEP_RULE in `exclude`
  // (same per-turn/restatable-content mechanism as FIELD_OBSERVATION_
  // DIRECTIVE and MACHINE CONTEXT) — Codex's example AND 5 more realistic
  // LOTO/isolation answers must all clear, against both prompt shapes that
  // carry the rule.
  for (const name of ["GENERAL_WITH_STEP_SAFETY", "BASE_WITH_STEP_SAFETY"] as const) {
    it.each(PROMPT_LEAK_ISOLATION_FIXTURES)(`%s — not flagged against ${name} once ISOLATION_STEP_RULE is excluded`, (answerText) => {
      const r = detectPromptLeak(PROMPTS[name], answerText, [ISOLATION_STEP_RULE]);
      expect(r.leaked).toBe(false);
    });
  }

  // Control: excluding ISOLATION_STEP_RULE must NOT blind the guard to a
  // full prompt echo — the persona opening line and HONESTY/SAFETY/
  // Instructions sections are untouched by this exclusion and still carry a
  // 12-word run.
  for (const name of ["GENERAL_WITH_STEP_SAFETY", "BASE_WITH_STEP_SAFETY"] as const) {
    it(`a full verbatim echo of ${name} is still flagged even with ISOLATION_STEP_RULE excluded`, () => {
      const prompt = PROMPTS[name];
      const r = detectPromptLeak(prompt, prompt, [ISOLATION_STEP_RULE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  }
});

describe("#4891 F7 — section-label extraction (signal 3) respects `exclude`, same as the n-gram signals", () => {
  // Codex's exact repro shape: an asset description with three ALL-CAPS-
  // header-shaped lines (MOTOR DATA / RATED SPEED / SERVICE FACTOR) that
  // occur EXCLUSIVELY inside an excluded per-turn data block.
  const NAMEPLATE_BLOCK = "MOTOR DATA: 480 V\nRATED SPEED: 1750 RPM\nSERVICE FACTOR: 1.15";
  const promptWithNameplate = `${GENERAL_SYSTEM_PROMPT}\n\n${NAMEPLATE_BLOCK}`;
  // Deliberately reworded (an "is"/"and" inserted after each label) so this
  // answer trips ONLY signal 3 (section-labels) when unexcluded — not
  // signal 1 (the block is exactly 12 words, so restating it CONTIGUOUSLY
  // would also trip the verbatim-run signal, muddying which signal this
  // test is actually isolating).
  const ratingsAnswer =
    "Per the nameplate: MOTOR DATA is 480 V, RATED SPEED is 1750 RPM, and SERVICE FACTOR is 1.15 — typical for this frame.";

  it("proves the bug existed: the three headings flag signal 3 when NOT excluded", () => {
    const r = detectPromptLeak(promptWithNameplate, ratingsAnswer);
    expect(r.leaked).toBe(true);
    expect(r.violation).toBe("prompt-leak:section-labels");
    expect(r.detail).toContain("MOTOR DATA");
  });

  it("the fix: excluding the block that contains them clears the answer", () => {
    const r = detectPromptLeak(promptWithNameplate, ratingsAnswer, [NAMEPLATE_BLOCK]);
    expect(r.leaked).toBe(false);
  });

  it("control: a paraphrase retaining three PROTECTED instruction headings (outside the excluded block) is still blocked, exclude in effect", () => {
    // Same structure-preserving paraphrase as the probe-shapes suite above
    // (ANSWER SHAPE / HONESTY / SAFETY, never excluded) — copied rather than
    // hoisted out of that describe's scope, so this test stays self-contained.
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
    const r = detectPromptLeak(promptWithNameplate, structurePreservingParaphrase, [NAMEPLATE_BLOCK]);
    expect(r.leaked).toBe(true);
    expect(r.violation).toBe("prompt-leak:section-labels");
    expect(r.detail).toContain("ANSWER SHAPE");
    expect(r.detail).toContain("HONESTY");
    expect(r.detail).toContain("SAFETY");
  });
});

describe("#4891 F8 — systematic audit: every newly-excluded restatable span, per directive", () => {
  // PHOTO_PROVENANCE_NOTE — notebook, conditional on a photo observation.
  describe("PHOTO_PROVENANCE_NOTE", () => {
    const prompt = `${GENERAL_SYSTEM_PROMPT}\n\n${FIELD_OBSERVATION_DIRECTIVE}\n\n${PHOTO_PROVENANCE_NOTE}`;

    it("Codex's exact reproduction DOES flag when not excluded (proves the bug existed)", () => {
      const r = detectPromptLeak(prompt, PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES[0]);
      expect(r.leaked).toBe(true);
    });

    it.each(PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES)("%s — not flagged once PHOTO_PROVENANCE_NOTE is excluded", (answer) => {
      const r = detectPromptLeak(prompt, answer, [PHOTO_PROVENANCE_NOTE]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo is still flagged even with PHOTO_PROVENANCE_NOTE excluded", () => {
      const r = detectPromptLeak(prompt, prompt, [PHOTO_PROVENANCE_NOTE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  });

  // RESTART_DIRECTIVE — notebook, conditional on a fault-reset/restart ask.
  describe("RESTART_DIRECTIVE", () => {
    const prompt = `${GENERAL_SYSTEM_PROMPT}\n\n${FIELD_OBSERVATION_DIRECTIVE}\n\n${RESTART_DIRECTIVE}`;

    it("Codex's exact reproduction DOES flag when not excluded (proves the bug existed)", () => {
      const r = detectPromptLeak(prompt, PROMPT_LEAK_RESTART_FIXTURES[0]);
      expect(r.leaked).toBe(true);
    });

    it.each(PROMPT_LEAK_RESTART_FIXTURES)("%s — not flagged once RESTART_DIRECTIVE is excluded", (answer) => {
      const r = detectPromptLeak(prompt, answer, [RESTART_DIRECTIVE]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo is still flagged even with RESTART_DIRECTIVE excluded", () => {
      const r = detectPromptLeak(prompt, prompt, [RESTART_DIRECTIVE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  });

  // GENERAL_NFPA_CAUTION — notebook, unconditional, inline in GENERAL_SYSTEM_PROMPT.
  describe("GENERAL_NFPA_CAUTION", () => {
    it("Codex's exact reproduction DOES flag when not excluded (proves the bug existed)", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_NFPA_FIXTURES[0]);
      expect(r.leaked).toBe(true);
    });

    it.each(PROMPT_LEAK_GENERAL_NFPA_FIXTURES)("%s — not flagged once GENERAL_NFPA_CAUTION is excluded", (answer) => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_NFPA_CAUTION]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_NFPA_CAUTION excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_NFPA_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  });

  // BASE_NFPA_CAUTION — notebook, unconditional, inline in BASE_SYSTEM_PROMPT.
  describe("BASE_NFPA_CAUTION", () => {
    it("Codex-style exact reproduction (BASE_SYSTEM_PROMPT's own phrasing) DOES flag when not excluded", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, PROMPT_LEAK_BASE_NFPA_FIXTURES[0]);
      expect(r.leaked).toBe(true);
    });

    it.each(PROMPT_LEAK_BASE_NFPA_FIXTURES)("%s — not flagged once BASE_NFPA_CAUTION is excluded", (answer) => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, answer, [BASE_NFPA_CAUTION]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo of BASE_SYSTEM_PROMPT is still flagged even with BASE_NFPA_CAUTION excluded", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, BASE_SYSTEM_PROMPT, [BASE_NFPA_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  });
});

describe("#3785 — a server-written SAFETY BANNER prepended to a candidate must not false-positive", () => {
  // The route calls detectPromptLeak AFTER validateAnswer's own hazard/
  // specificity floor has already run (same seam, see route.ts's #3785
  // comment) — so by the time the hook sees `answerText`, a hazard_warning/
  // energized_warning path may have already PREPENDED a fixed, server-
  // written banner to the candidate (owner decision 2026-09-27: flags never
  // withhold). Real example seen live in this module's own test runs: the
  // grounded leak-probe candidate tripped `hazard-warning:step-energy-
  // contradiction` before tripping this guard. These banners reuse safety
  // vocabulary the prompt also uses (lockout, energized, qualified person),
  // so they are exactly the shape most at risk of a false positive — but
  // they are FIXED, SHORT, server-authored strings, never 12 words lifted
  // from the prompt. Calling the REAL `validateAnswer` (not hand-copying its
  // replacement template) proves this on the actual generated text.
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    it(`validateAnswer's real energized_warning (A4) replacement is not flagged against ${name}`, () => {
      const v = validateAnswer({
        answerText: "Re-energize the panel and take the amp reading on each phase with the clamp meter.",
        question: "Can I check the current while the panel is on?",
        general: false,
        served: true,
        refused: false,
      });
      expect(v.ok).toBe(false);
      if (v.ok) throw new Error("unreachable");
      expect(v.kind).toBe("energized_warning");
      expect(detectPromptLeak(prompt, v.replacement).leaked).toBe(false);
    });

    it(`validateAnswer's real hazard_warning replacement is not flagged against ${name}`, () => {
      const v = validateAnswer({
        answerText: "Yes, the TS-440 permits resetting the E-12 fault while the machine remains energized [1].",
        question: "Can I reset the E-12 fault while it's energized?",
        general: false,
        served: true,
        refused: false,
      });
      expect(v.ok).toBe(false);
      if (v.ok) throw new Error("unreachable");
      expect(v.kind).toBe("hazard_warning");
      expect(detectPromptLeak(prompt, v.replacement).leaked).toBe(false);
    });

    it(`UNCITED_OEM_CLAIM_TEXT is not flagged against ${name}`, () => {
      expect(detectPromptLeak(prompt, UNCITED_OEM_CLAIM_TEXT).leaked).toBe(false);
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
