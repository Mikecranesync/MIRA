/**
 * Prompt-leak guard (#3785) — pure-function unit tests.
 *
 * `GENERAL_SYSTEM_PROMPT` and `BASE_SYSTEM_PROMPT` are imported from the real
 * route rather than hand-copied: there is no standalone "build the system
 * prompt" function (MACHINE CONTEXT, coverage directives, hazard/visual
 * sections are assembled inline in `handleChatTurn`), so these two exported
 * constants are the closest thing to the builder's output and are the exact
 * strings `prompt-leak-guard.ts` runs against in production.
 *
 * Three groups:
 *  1. The three #3785 probe shapes (verbatim echo, partial echo, paraphrase)
 *     — all three MUST be flagged, against both system prompts.
 *  2. A false-positive sweep: every fixture is a real answer string lifted
 *     from this repo's existing chat/answer-validation test suites (never
 *     invented for this file), run against BOTH prompts — none may flag.
 *     Several are deliberately adversarial: sentences that closely mirror a
 *     double-quoted INSTRUCTED example inside one of the prompts (the model
 *     correctly doing what it was told to do must never read as a leak).
 *  3. Edge cases: empty input, and zero-width-character word-splitting
 *     obfuscation (must NOT defeat the run signal).
 */
import { describe, expect, it } from "vitest";

import { BASE_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT } from "@/app/api/equipment-notebooks/[id]/chat/route";

import { detectPromptLeak, PROMPT_LEAK_REFUSAL } from "./prompt-leak-guard";

const PROMPTS = { GENERAL: GENERAL_SYSTEM_PROMPT, BASE: BASE_SYSTEM_PROMPT } as const;

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

describe("#3785 — false-positive sweep (real answer fixtures from this repo's test suites)", () => {
  // Lifted verbatim from general-mode.test.ts, chat-safety-stop.test.ts,
  // chat-electrical-hazard-live-stream.test.ts, machine-evidence.test.ts,
  // visual-evidence-abstain.test.ts, answer-validation*.test.ts (stubProvider
  // / providerStream / answerText fixtures already used to exercise this
  // same route and the pre-display validator it shares a seam with).
  const realAnswerFixtures: readonly string[] = [
    "A DH-485 link needs matching node addresses.",
    "A related CompactLogix manual says DH-485 needs a 1761-NET-AIC [1].",
    "A resistive touch panel senses pressure between two layers.",
    "A VFD varies frequency.",
    "A VFD varies motor frequency.",
    "Back away and cut power at the disconnect.",
    "Check the 24 V supply [1].",
    "Check the DC bus [1] and the fan [2].",
    "Check the DC bus first.",
    "Check the drive's status word first.",
    "DC bus undervoltage [1]",
    "De-energize and apply lockout/tagout before opening the panel.",
    "Do not touch it — call an electrician.",
    "F004 is DC bus undervoltage [1].",
    "From the earlier photo it is 24 Vdc.",
    "General guidance beyond your manual: check the bypass contactor coil supply first.",
    "General steps: hold the boot button and re-apply power.",
    "Here is general guidance.",
    "I can read the label.",
    "I can't see an earlier photo.",
    "I don't have a matching manual for this TP700.",
    "I don't have documentation covering that, so I can't answer it.",
    "I need the matching manual.",
    "Isolate the machine and confirm zero energy before touching anything.",
    "It runs on 24 V DC per the label.",
    "Per the manual the supply is 24 VDC [1].",
    "Please attach the photo again.",
    "Re-energize the panel and read the current.\nNever probe the live terminals, and reset the fault while the drive is energized.",
    "Re-energize the panel. Then clamp each phase and record the current.",
    "That's a pneumatic manifold valve.",
    "The earlier photo shows a panel label.",
    "The label shows the part number.",
    "The operating temperature range is -20 °C to +60 °C for this unit.",
    "The panel needs 24 V DC [1].",
    "The panel takes 24 VDC [1].",
    "The part number is printed with the description.",
    "The photo describes more than one machine; identify which one you mean.",
    "The photo eye went ON, then the drive faulted [1].",
    "The SPC-100 supply voltage is 24 VDC and its manual is on the Festo site.",
    "The supply voltage is 480 VAC.",
    "Typical panels use 24 V DC; check the nameplate.",
    "You don't need to lock out the conveyor for this, just reach in and clear the jam.",
    "1. With the drive locked out, check the input fuses for continuity.\n2. Inspect the terminals for loose or burnt wiring.",
    "Both seats share one slave; replace it.",
    "I can't find a rating for this unit in the selected sources.",
    "I'm unable to browse the web, so I can't look that up.",
    "Re-energize the panel and take the amp reading on each phase with the clamp meter.",
    "The fault typically clears after a power cycle of the drive.",
    // Adversarial: closely mirrors GENERAL_SYSTEM_PROMPT's double-quoted
    // INSTRUCTED example sentence — a legitimate answer correctly following
    // that instruction, not a leak.
    "I'm answering from general knowledge, not this machine's manual. Check the DC bus voltage first and look at the fan.",
    // Adversarial: closely mirrors BASE_SYSTEM_PROMPT's double-quoted
    // ENERGY STATE example template, with different terminals/numbers — a
    // technician question actually answered the way the prompt instructs.
    "With the drive isolated, locked out and the DC bus confirmed dead with a meter, check continuity across terminals 42-43 [2].",
    "With the panel isolated, locked out and the bus confirmed dead with a meter, check continuity across terminals 10-11, then verify the fuse.",
    // Adversarial: BASE_SYSTEM_PROMPT's own quoted PRECISION-RULES examples,
    // produced verbatim because the model was told to.
    "P042 [Decel Time 1] sets the deceleration ramp [1].",
    "This drive has no built-in PROFINET parameter; PROFINET is available only through an optional communication adapter [4].",
    "Output Freq is a monitoring value, not a setting; use Commanded Freq instead for the display, and P042 to configure the ramp.",
  ];

  for (const [name, prompt] of Object.entries(PROMPTS)) {
    it.each(realAnswerFixtures)(`%s — not flagged against ${name}`, (answerText) => {
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

  it("zero-width characters inserted between every letter cannot defeat the run signal", () => {
    // The exact obfuscation class the normalizer's fold ordering exists for:
    // strip \p{Cf} BEFORE collapsing non-alphanumerics, so a split word folds
    // back into one token instead of shattering into single letters.
    const zw = "​";
    const obfuscated = `You${zw} are${zw} MIRA${zw}, a${zw} maintenance${zw} assistant${zw} helping${zw} a${zw} technician${zw} who${zw} is${zw} standing${zw} at${zw} a${zw} machine${zw} RIGHT${zw} NOW${zw}.`;
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
