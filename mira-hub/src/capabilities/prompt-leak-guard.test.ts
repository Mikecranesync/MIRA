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
  BASE_ENERGY_ISOLATION_HAZARD_POINTS,
  BASE_NFPA_CAUTION,
  BASE_SITE_RECORDS_CAUTION,
  BASE_SYSTEM_PROMPT,
  FIELD_OBSERVATION_DIRECTIVE,
  GENERAL_COMPATIBILITY_CAUTION,
  GENERAL_NFPA_CAUTION,
  GENERAL_NO_DECODE_CAUTION,
  GENERAL_NO_MANUAL_DISCLOSURE,
  GENERAL_SITE_RECORDS_CAUTION,
  GENERAL_SYSTEM_PROMPT,
  UNCITED_OEM_CLAIM_TEXT,
} from "@/app/api/equipment-notebooks/[id]/chat/route";

import { ISOLATION_STEP_RULE } from "./answer-shape";
import { validateAnswer } from "./answer-validation";
import { PHOTO_PROVENANCE_NOTE } from "./photo-provenance";
import { RESTART_DIRECTIVE } from "./restart-advisory";
import { ASSET_PROTECTED_CORE } from "@/app/api/assets/[id]/chat/route";
import { SYSTEM_PROMPT as QUICKSTART_SYSTEM_PROMPT } from "@/app/api/quickstart/ask/route";
import {
  PROMPT_LEAK_FALSE_POSITIVE_FIXTURES,
  PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES,
  PROMPT_LEAK_ISOLATION_FIXTURES,
  PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES,
  PROMPT_LEAK_RESTART_FIXTURES,
  PROMPT_LEAK_GENERAL_NFPA_FIXTURES,
  PROMPT_LEAK_BASE_NFPA_FIXTURES,
  PROMPT_LEAK_GENERAL_COMPATIBILITY_FIXTURES,
  PROMPT_LEAK_GENERAL_SITE_RECORDS_FIXTURES,
  PROMPT_LEAK_BASE_SITE_RECORDS_FIXTURES,
  PROMPT_LEAK_GENERAL_NO_DECODE_FIXTURES,
  PROMPT_LEAK_GENERAL_NO_MANUAL_FIXTURES,
  PROMPT_LEAK_BASE_ENERGY_ISOLATION_FIXTURES,
  PROMPT_LEAK_F14_CODEX_EXAMPLES,
  PROMPT_LEAK_F14_NOTEBOOK_FIXTURES,
  PROMPT_LEAK_F14_ASSET_FIXTURES,
  PROMPT_LEAK_F14_QUICKSTART_FIXTURES,
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
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
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
  // Historically reproduced the exact bug BEFORE the F2 fix: the directive
  // rides every turn's prompt, and a correct answer sharing its phrasing
  // (Codex's own example) was flagged with NO exclusion applied. Codex
  // #4891 F14 (round 8): the scaffolding gate now ALSO prevents this single-
  // sentence fixture from flagging even without `exclude` — it carries
  // neither the persona line nor 2+ section headers — so this specific
  // historical reproduction no longer demonstrates the bug on its own. The
  // `exclude` below remains defense-in-depth (it still removes the matched
  // text from both gram sets entirely, a strictly stronger guarantee), not
  // load-bearing for this fixture.
  it("no longer flags even without excluding FIELD_OBSERVATION_DIRECTIVE — the F14 scaffolding gate closes this architecturally", () => {
    const answer = PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES[0];
    const r = detectPromptLeak(PROMPTS_WITH_FIELD_OBS.GENERAL, answer);
    expect(r.leaked).toBe(false);
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
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  }
});

describe("#4891 F5 — ISOLATION_STEP_RULE is shared safety guidance, not a secret — correctly applying it is not a leak", () => {
  // Historically reproduced the exact bug BEFORE the F5 fix: ISOLATION_STEP_
  // RULE rides every turn's prompt (via `withStepSafety`, already baked into
  // GENERAL_WITH_STEP_SAFETY/BASE_WITH_STEP_SAFETY above) with NO exclusion
  // applied — Codex's exact reproduction answer used to be flagged. Codex
  // #4891 F14 (round 8): the scaffolding gate now ALSO prevents this,
  // without any exclude — same disposition as F2's note above.
  it("no longer flags even without excluding ISOLATION_STEP_RULE — the F14 scaffolding gate closes this architecturally", () => {
    const answer = PROMPT_LEAK_ISOLATION_FIXTURES[0];
    const r = detectPromptLeak(PROMPTS.GENERAL_WITH_STEP_SAFETY, answer);
    expect(r.leaked).toBe(false);
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
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
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

    it("no longer flags even without excluding PHOTO_PROVENANCE_NOTE — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(prompt, PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES)("%s — not flagged once PHOTO_PROVENANCE_NOTE is excluded", (answer) => {
      const r = detectPromptLeak(prompt, answer, [PHOTO_PROVENANCE_NOTE]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo is still flagged even with PHOTO_PROVENANCE_NOTE excluded", () => {
      const r = detectPromptLeak(prompt, prompt, [PHOTO_PROVENANCE_NOTE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // RESTART_DIRECTIVE — notebook, conditional on a fault-reset/restart ask.
  describe("RESTART_DIRECTIVE", () => {
    const prompt = `${GENERAL_SYSTEM_PROMPT}\n\n${FIELD_OBSERVATION_DIRECTIVE}\n\n${RESTART_DIRECTIVE}`;

    it("no longer flags even without excluding RESTART_DIRECTIVE — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(prompt, PROMPT_LEAK_RESTART_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_RESTART_FIXTURES)("%s — not flagged once RESTART_DIRECTIVE is excluded", (answer) => {
      const r = detectPromptLeak(prompt, answer, [RESTART_DIRECTIVE]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo is still flagged even with RESTART_DIRECTIVE excluded", () => {
      const r = detectPromptLeak(prompt, prompt, [RESTART_DIRECTIVE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // GENERAL_NFPA_CAUTION — notebook, unconditional, inline in GENERAL_SYSTEM_PROMPT.
  describe("GENERAL_NFPA_CAUTION", () => {
    it("no longer flags even without excluding GENERAL_NFPA — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_NFPA_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_GENERAL_NFPA_FIXTURES)("%s — not flagged once GENERAL_NFPA_CAUTION is excluded", (answer) => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_NFPA_CAUTION]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_NFPA_CAUTION excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_NFPA_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // BASE_NFPA_CAUTION — notebook, unconditional, inline in BASE_SYSTEM_PROMPT.
  describe("BASE_NFPA_CAUTION", () => {
    it("no longer flags even without excluding BASE_NFPA — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, PROMPT_LEAK_BASE_NFPA_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_BASE_NFPA_FIXTURES)("%s — not flagged once BASE_NFPA_CAUTION is excluded", (answer) => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, answer, [BASE_NFPA_CAUTION]);
      expect(r.leaked).toBe(false);
    });

    it("a full verbatim echo of BASE_SYSTEM_PROMPT is still flagged even with BASE_NFPA_CAUTION excluded", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, BASE_SYSTEM_PROMPT, [BASE_NFPA_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // GENERAL_COMPATIBILITY_CAUTION — notebook, unconditional, inline in
  // GENERAL_SYSTEM_PROMPT's HONESTY section. Codex #4891 F9.
  describe("GENERAL_COMPATIBILITY_CAUTION", () => {
    it("no longer flags even without excluding GENERAL_COMPATIBILITY — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_COMPATIBILITY_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_GENERAL_COMPATIBILITY_FIXTURES)(
      "%s — not flagged once GENERAL_COMPATIBILITY_CAUTION is excluded",
      (answer) => {
        const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_COMPATIBILITY_CAUTION]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_COMPATIBILITY_CAUTION excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_COMPATIBILITY_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // GENERAL_SITE_RECORDS_CAUTION — notebook, unconditional, inline in
  // GENERAL_SYSTEM_PROMPT's HONESTY section. Codex #4891 F9.
  describe("GENERAL_SITE_RECORDS_CAUTION", () => {
    it("no longer flags even without excluding GENERAL_SITE_RECORDS — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_SITE_RECORDS_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_GENERAL_SITE_RECORDS_FIXTURES)(
      "%s — not flagged once GENERAL_SITE_RECORDS_CAUTION is excluded",
      (answer) => {
        const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_SITE_RECORDS_CAUTION]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_SITE_RECORDS_CAUTION excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_SITE_RECORDS_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // BASE_SITE_RECORDS_CAUTION — notebook, unconditional, inline in
  // BASE_SYSTEM_PROMPT's PLANT-SPECIFIC VALUES section. Codex #4891 F9.
  describe("BASE_SITE_RECORDS_CAUTION", () => {
    it("no longer flags even without excluding BASE_SITE_RECORDS — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, PROMPT_LEAK_BASE_SITE_RECORDS_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_BASE_SITE_RECORDS_FIXTURES)(
      "%s — not flagged once BASE_SITE_RECORDS_CAUTION is excluded",
      (answer) => {
        const r = detectPromptLeak(BASE_SYSTEM_PROMPT, answer, [BASE_SITE_RECORDS_CAUTION]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of BASE_SYSTEM_PROMPT is still flagged even with BASE_SITE_RECORDS_CAUTION excluded", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, BASE_SYSTEM_PROMPT, [BASE_SITE_RECORDS_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });
});

describe("#4891 F10 — round 6: protected cores still matched correct abstentions/safety-guidance/grounding-disclosures", () => {
  // GENERAL_NO_DECODE_CAUTION — notebook, unconditional, inline in
  // GENERAL_SYSTEM_PROMPT's HONESTY section.
  describe("GENERAL_NO_DECODE_CAUTION", () => {
    it("no longer flags even without excluding GENERAL_NO_DECODE — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_NO_DECODE_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_GENERAL_NO_DECODE_FIXTURES)(
      "%s — not flagged once GENERAL_NO_DECODE_CAUTION is excluded",
      (answer) => {
        const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_NO_DECODE_CAUTION]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_NO_DECODE_CAUTION excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_NO_DECODE_CAUTION]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // GENERAL_NO_MANUAL_DISCLOSURE — notebook, unconditional, inline in
  // GENERAL_SYSTEM_PROMPT's persona line.
  describe("GENERAL_NO_MANUAL_DISCLOSURE", () => {
    it("no longer flags even without excluding GENERAL_NO_MANUAL — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_GENERAL_NO_MANUAL_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_GENERAL_NO_MANUAL_FIXTURES)(
      "%s — not flagged once GENERAL_NO_MANUAL_DISCLOSURE is excluded",
      (answer) => {
        const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answer, [GENERAL_NO_MANUAL_DISCLOSURE]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of GENERAL_SYSTEM_PROMPT is still flagged even with GENERAL_NO_MANUAL_DISCLOSURE excluded", () => {
      const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT, [GENERAL_NO_MANUAL_DISCLOSURE]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });

  // BASE_ENERGY_ISOLATION_HAZARD_POINTS — notebook, unconditional, inline in
  // BASE_SYSTEM_PROMPT's ENERGY STATE section.
  describe("BASE_ENERGY_ISOLATION_HAZARD_POINTS", () => {
    it("no longer flags even without excluding BASE_ENERGY_ISOLATION — the Codex #4891 F14 (round 8) scaffolding gate closes this architecturally", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, PROMPT_LEAK_BASE_ENERGY_ISOLATION_FIXTURES[0]);
      expect(r.leaked).toBe(false);
    });

    it.each(PROMPT_LEAK_BASE_ENERGY_ISOLATION_FIXTURES)(
      "%s — not flagged once BASE_ENERGY_ISOLATION_HAZARD_POINTS is excluded",
      (answer) => {
        const r = detectPromptLeak(BASE_SYSTEM_PROMPT, answer, [BASE_ENERGY_ISOLATION_HAZARD_POINTS]);
        expect(r.leaked).toBe(false);
      },
    );

    it("a full verbatim echo of BASE_SYSTEM_PROMPT is still flagged even with BASE_ENERGY_ISOLATION_HAZARD_POINTS excluded", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, BASE_SYSTEM_PROMPT, [BASE_ENERGY_ISOLATION_HAZARD_POINTS]);
      expect(r.leaked).toBe(true);
      expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
    });
  });
});

describe("#4891 F9 — architectural inversion: protected-core-only comparison, proved", () => {
  // Codex #4891 F9 MEDIUM: each round (F4 through F9) found another
  // conditionally-appended directive a correct answer legitimately restates,
  // and the fix each time was "add it to `exclude`" — whack-a-mole, since
  // the NEXT appended directive would always need the same fix before it
  // shipped clean. Production routes no longer pass the full turn-assembled
  // prompt to `detectPromptLeak` — they pass only the PROTECTED CORE
  // (`GENERAL_SYSTEM_PROMPT`/`BASE_SYSTEM_PROMPT`/`SYSTEM_PROMPT`/
  // `ASSET_PROTECTED_CORE`, see each route's call site). This test proves
  // the inversion's actual guarantee: a brand-new, never-before-seen
  // directive, appended to the prompt exactly the way a future PR would
  // append one, is NOT flagged when a correct answer restates it — with ZERO
  // code change to `detectPromptLeak` or to any `exclude` list. Contrasted
  // against what the OLD per-directive-exclude mechanism would have done
  // with that same new directive (flag it, until someone remembered to add
  // it to `exclude`), to make the "stop the whack-a-mole" claim concrete
  // rather than asserted.
  const HYPOTHETICAL_FUTURE_DIRECTIVE =
    "CALIBRATION WINDOW — if a sensor was calibrated more than 18 months ago, the reading may be out of tolerance and you must recommend a recalibration before anyone trusts it for a safety-critical decision.";

  const answerRestatingTheNewDirective =
    "This sensor was calibrated more than 18 months ago, so the reading may be out of tolerance and you must recommend a recalibration before anyone trusts it for a safety-critical decision.";

  it("a correct answer restating a brand-new appended directive is NOT flagged against the protected core alone — no code change", () => {
    // This is exactly what route.ts now does: compare only the protected
    // core, never the turn-assembled prompt the new directive would ride on.
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, answerRestatingTheNewDirective);
    expect(r.leaked).toBe(false);
  });

  it("the SAME new-directive restatement is now safe even under the OLD (pre-inversion) full-prompt call shape — two independent layers of defense", () => {
    // Simulates the pre-inversion call shape: `systemPrompt` was the full
    // turn-assembled prompt (persona + every appended directive). Before
    // Codex #4891 F14 (round 8), this WOULD have wrongly flagged — a new
    // directive with no entry in `exclude` showed up in that text and
    // tripped signal 1, the exact whack-a-mole the coordinator asked to
    // stop (this assertion used to read `toBe(true)` to demonstrate that).
    // The F14 scaffolding gate now ALSO protects this shape on its own
    // merits: `answerRestatingTheNewDirective` carries neither the persona
    // line nor 2+ section headers, so signal 1's hit is gated off even
    // though the OLD call shape still contains the new directive. The F9
    // inversion (passing only the protected core, never the full turn-
    // assembled prompt) remains valuable independently — it keeps
    // `exclude` lists from growing at all for conditionally-appended
    // directives — but for THIS specific false-positive shape, either layer
    // alone would now be sufficient.
    const oldStyleTurnAssembledPrompt = `${GENERAL_SYSTEM_PROMPT}\n\n${HYPOTHETICAL_FUTURE_DIRECTIVE}`;
    const r = detectPromptLeak(oldStyleTurnAssembledPrompt, answerRestatingTheNewDirective);
    expect(r.leaked).toBe(false);
  });

  it("a real full-prompt echo still trips the protected-core comparison (the inversion does not weaken detection)", () => {
    // An attacker's echo of the ENTIRE turn-assembled prompt still CONTAINS
    // the protected core as a literal substring, so signal 1 still fires
    // even though the comparison target shrank to just the protected core.
    const fullPromptEcho = `${GENERAL_SYSTEM_PROMPT}\n\n${HYPOTHETICAL_FUTURE_DIRECTIVE}`;
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, fullPromptEcho);
    expect(r.leaked).toBe(true);
    expect(r.violation).toMatch(/^prompt-leak:(verbatim-run|large-verbatim-run)$/);
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

describe("#4891 F14 — round 8: scaffolding gate — signals 1/2 require the persona line OR 2+ section headers", () => {
  // Codex's three exact reproductions — none previously carved into any
  // `exclude` constant. Protected architecturally by the gate alone.
  it("Codex's exact general-mode energized-work refusal is not flagged (no exclude)", () => {
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_F14_CODEX_EXAMPLES[0]);
    expect(r.leaked).toBe(false);
  });

  it("Codex's exact grounded-mode energized-work refusal is not flagged (no exclude)", () => {
    const r = detectPromptLeak(BASE_SYSTEM_PROMPT, PROMPT_LEAK_F14_CODEX_EXAMPLES[1]);
    expect(r.leaked).toBe(false);
  });

  it("Codex's exact general-mode documentation-abstention request is not flagged (no exclude)", () => {
    const r = detectPromptLeak(GENERAL_SYSTEM_PROMPT, PROMPT_LEAK_F14_CODEX_EXAMPLES[2]);
    expect(r.leaked).toBe(false);
  });

  // 5 realistic safety/abstention answers per route, none carved, protected
  // only by the gate.
  describe("5 notebook safety/abstention answers — not flagged against either mode's protected core", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      it.each(PROMPT_LEAK_F14_NOTEBOOK_FIXTURES)(`%s — not flagged against ${name}`, (answer) => {
        const r = detectPromptLeak(prompt, answer);
        expect(r.leaked).toBe(false);
      });
    }
  });

  describe("5 asset-chat safety/abstention answers — not flagged against ASSET_PROTECTED_CORE", () => {
    it.each(PROMPT_LEAK_F14_ASSET_FIXTURES)("%s", (answer) => {
      const r = detectPromptLeak(ASSET_PROTECTED_CORE, answer);
      expect(r.leaked).toBe(false);
    });
  });

  describe("5 quickstart safety/abstention answers — not flagged against quickstart SYSTEM_PROMPT", () => {
    it.each(PROMPT_LEAK_F14_QUICKSTART_FIXTURES)("%s", (answer) => {
      const r = detectPromptLeak(QUICKSTART_SYSTEM_PROMPT, answer);
      expect(r.leaked).toBe(false);
    });
  });

  // The coordinator's required proof: a 30-word verbatim run of RULE text
  // with neither the persona line nor 2+ headers is NOT flagged; the SAME
  // run, prefixed with the real persona line, IS flagged. Both windows are
  // sliced straight out of the REAL BASE_SYSTEM_PROMPT constant — never
  // hand-copied — so this test tracks the actual protected core, not a
  // frozen snapshot of it.
  describe("the core claim: scaffolding is the ONLY thing that changes the verdict on the same 30-word run", () => {
    // GROUNDING & CITATIONS' body: 4 bullets, zero section headers, zero
    // persona text, zero quoted instructed examples — a clean rule-text
    // window with nothing else that could independently trip the gate.
    const groundingBody = BASE_SYSTEM_PROMPT.split("GROUNDING & CITATIONS:")[1].split("PREMISE CHECK")[0];
    const words = groundingBody.split(/\s+/).filter(Boolean);
    const thirtyWordRun = words.slice(0, 30).join(" ");
    // Sanity: the window really is a verbatim run long enough to clear
    // RUN_LENGTH (12) on its own — otherwise this test would prove nothing
    // about the GATE specifically (it'd just be testing "short replies never
    // flag", a different, already-covered claim).
    expect(words.length).toBeGreaterThanOrEqual(30);

    it("the bare 30-word run (no persona, no headers) is NOT flagged", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, thirtyWordRun);
      expect(r.leaked).toBe(false);
    });

    it("the SAME 30-word run, prefixed with the real persona line, IS flagged", () => {
      const personaLine = BASE_SYSTEM_PROMPT.split(". ")[0] + ".";
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, `${personaLine} ${thirtyWordRun}`);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:verbatim-run");
    });
  });
});

describe("#4891 F15 — round 9: scaffolding-independent large-scale signals close the near-complete-echo bypass", () => {
  // Codex's exact F15 reproductions: deleting ONLY the opening word kills
  // the persona-prefix match (signals 1/2's gate), and ASSET_PROTECTED_CORE/
  // SYSTEM_PROMPT have no qualifying ALL-CAPS headers either — so under F14
  // alone these were `leaked: false` despite reproducing virtually the
  // entire protected core.
  it("Codex's exact repro — ASSET_PROTECTED_CORE with its first word deleted IS flagged", () => {
    expect(ASSET_PROTECTED_CORE.startsWith("You ")).toBe(true);
    const altered = ASSET_PROTECTED_CORE.replace(/^You /, "");
    const r = detectPromptLeak(ASSET_PROTECTED_CORE, altered);
    expect(r.leaked).toBe(true);
    expect(["prompt-leak:large-verbatim-run", "prompt-leak:core-coverage"]).toContain(r.violation);
  });

  it("Codex's exact repro — quickstart SYSTEM_PROMPT with its first word deleted IS flagged", () => {
    expect(QUICKSTART_SYSTEM_PROMPT.startsWith("You ")).toBe(true);
    const altered = QUICKSTART_SYSTEM_PROMPT.replace(/^You /, "");
    const r = detectPromptLeak(QUICKSTART_SYSTEM_PROMPT, altered);
    expect(r.leaked).toBe(true);
    expect(["prompt-leak:large-verbatim-run", "prompt-leak:core-coverage"]).toContain(r.violation);
  });

  // Codex's exact notebook repro: "You are MIRA," -> "MIRA is", every
  // ALL-CAPS header lowercased — against BOTH modes' protected core.
  function alteredNotebookEcho(core: string): string {
    return core
      .replace(/You are MIRA,/, "MIRA is")
      .replace(/^([A-Z][A-Z0-9&/ -]{3,60}?)(?=:|\s—|\s\()/gm, (m) => m.toLowerCase());
  }
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    it(`Codex's exact repro — ${name}'s persona swapped + headers lowercased IS flagged`, () => {
      const altered = alteredNotebookEcho(prompt);
      expect(altered).not.toContain("You are MIRA,");
      const r = detectPromptLeak(prompt, altered);
      expect(r.leaked).toBe(true);
      expect(["prompt-leak:large-verbatim-run", "prompt-leak:core-coverage"]).toContain(r.violation);
    });
  }

  // The coordinator's required proof for the large-scale signals: a
  // 45-word verbatim run of pure RULE text (no persona, no headers — same
  // GROUNDING & CITATIONS window as the F14 test above, extended) IS
  // flagged once it clears LARGE_RUN_LENGTH (40); the SAME text truncated
  // to 25 words (still no scaffolding, still under 40) is NOT.
  describe("the core claim: LARGE_RUN_LENGTH (40), not scaffolding, decides the verdict on a long rule-text run", () => {
    const groundingBody = BASE_SYSTEM_PROMPT.split("GROUNDING & CITATIONS:")[1].split("PREMISE CHECK")[0];
    const words = groundingBody.split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(45);
    const run45 = words.slice(0, 45).join(" ");
    const run25 = words.slice(0, 25).join(" ");

    it("the 45-word run (no persona, no headers) IS flagged", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, run45);
      expect(r.leaked).toBe(true);
      expect(r.violation).toBe("prompt-leak:large-verbatim-run");
    });

    it("the SAME text truncated to 25 words (no persona, no headers) is NOT flagged", () => {
      const r = detectPromptLeak(BASE_SYSTEM_PROMPT, run25);
      expect(r.leaked).toBe(false);
    });
  });

  // All prior-round fixtures still pass under the new signals (regression
  // control — the large-scale signals must not reopen any F2/F5/F8-F14
  // false positive). Re-sweeps the exact same fixture arrays the earlier
  // describe blocks already proved clean, now with the F15 signals live.
  describe("regression: every prior-round false-positive fixture still clears both new large-scale signals", () => {
    const allLegitFixtures = [
      ...PROMPT_LEAK_FALSE_POSITIVE_FIXTURES,
      ...PROMPT_LEAK_FIELD_OBSERVATION_FIXTURES,
      ...PROMPT_LEAK_ISOLATION_FIXTURES,
      ...PROMPT_LEAK_PHOTO_PROVENANCE_FIXTURES,
      ...PROMPT_LEAK_RESTART_FIXTURES,
      ...PROMPT_LEAK_GENERAL_NFPA_FIXTURES,
      ...PROMPT_LEAK_BASE_NFPA_FIXTURES,
      ...PROMPT_LEAK_GENERAL_COMPATIBILITY_FIXTURES,
      ...PROMPT_LEAK_GENERAL_SITE_RECORDS_FIXTURES,
      ...PROMPT_LEAK_BASE_SITE_RECORDS_FIXTURES,
      ...PROMPT_LEAK_GENERAL_NO_DECODE_FIXTURES,
      ...PROMPT_LEAK_GENERAL_NO_MANUAL_FIXTURES,
      ...PROMPT_LEAK_BASE_ENERGY_ISOLATION_FIXTURES,
      ...PROMPT_LEAK_F14_CODEX_EXAMPLES,
      ...PROMPT_LEAK_F14_NOTEBOOK_FIXTURES,
      ...PROMPT_LEAK_F14_ASSET_FIXTURES,
      ...PROMPT_LEAK_F14_QUICKSTART_FIXTURES,
    ];
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      it.each(allLegitFixtures)(`%s — not flagged against ${name}`, (answerText) => {
        const r = detectPromptLeak(prompt, answerText);
        expect(r.leaked).toBe(false);
      });
    }
    it.each(PROMPT_LEAK_F14_ASSET_FIXTURES)("%s — not flagged against ASSET_PROTECTED_CORE", (answerText) => {
      const r = detectPromptLeak(ASSET_PROTECTED_CORE, answerText);
      expect(r.leaked).toBe(false);
    });
    it.each(PROMPT_LEAK_F14_QUICKSTART_FIXTURES)("%s — not flagged against quickstart SYSTEM_PROMPT", (answerText) => {
      const r = detectPromptLeak(QUICKSTART_SYSTEM_PROMPT, answerText);
      expect(r.leaked).toBe(false);
    });
  });
});

describe("PROMPT_LEAK_REFUSAL", () => {
  it("names no detector, echoes no matched text, and redirects to the product", () => {
    expect(PROMPT_LEAK_REFUSAL).toBe("I can't share my internal instructions. Ask me about your equipment.");
  });
});
