/**
 * Property tests for the MIRA Intelligence Contract.
 *
 * These assert the invariants that a prompt-unification refactor is most likely to
 * break silently — above all the general-mode bracket ban. Precisely: the mobile
 * renderer does NOT emit a dangling chip for an unknown id, so a stray `[1]` renders
 * as literal text; the harm is representational (plain `[1]` reads as a citation to a
 * technician), not a broken widget.
 *
 * Spec: `docs/specs/mira-intelligence-contract.md`
 * Audit: `docs/audits/2026-09-22-mira-persona-inventory.md`
 */
import { describe, it, expect } from "vitest";
import {
  buildMiraSystemPrompt,
  MIRA_CORE,
  MIRA_GROUNDED,
  MIRA_AUGMENTED,
  MIRA_GENERAL,
  type MiraMode,
} from "../mira-contract";

const MODES: MiraMode[] = ["grounded", "augmented", "general"];

describe("MIRA contract — shared identity (§1)", () => {
  it.each(MODES)("%s mode opens with the pinned `You are MIRA` literal", (mode) => {
    // machine-evidence.test.ts:219 asserts this literal precedes the machine
    // evidence block. If the opening changes, that route test breaks.
    expect(buildMiraSystemPrompt(mode).startsWith("You are MIRA")).toBe(true);
  });

  it.each(MODES)("%s mode carries one identity, not a second persona", (mode) => {
    // Exactly one `You are MIRA` — a second would mean a fork got concatenated in.
    const occurrences = buildMiraSystemPrompt(mode).match(/You are MIRA/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it.each(MODES)("%s mode carries the shared doctrine core verbatim", (mode) => {
    expect(buildMiraSystemPrompt(mode)).toContain(MIRA_CORE);
  });
});

describe("MIRA contract — the general-mode bracket ban (§3.2)", () => {
  it("general mode forbids bracketed citation markers", () => {
    expect(buildMiraSystemPrompt("general")).toContain("NEVER write bracketed numeric markers");
  });

  it("the shared core NEVER teaches citation syntax", () => {
    // Anything taught in MIRA_CORE is inherited by general mode; a citation rule
    // there would re-teach the exact syntax the general block bans, and the two
    // would fight inside one prompt.
    expect(MIRA_CORE).not.toMatch(/\[1\]|\[2\]|\[n\]/);
    expect(MIRA_CORE.toLowerCase()).not.toContain("cite");
  });

  it("general mode never instructs the model to cite", () => {
    const general = buildMiraSystemPrompt("general");
    expect(general).not.toMatch(/cite it with \[n\]|Cite every factual claim/);
  });

  it("grounded and augmented modes DO teach citation syntax", () => {
    expect(MIRA_GROUNDED).toContain("[1]");
    expect(MIRA_AUGMENTED).toContain("[n]");
  });
});

describe("MIRA contract — evidence rules differ by mode (§3)", () => {
  it("grounded mode keeps cite-or-refuse", () => {
    expect(MIRA_GROUNDED).toContain("cite NOTHING");
    expect(MIRA_GROUNDED).toContain("Cite every factual claim");
  });

  it("augmented mode answers anyway when the corpus misses — the golden rule", () => {
    // The property that distinguishes augmented from grounded. If this ever
    // regresses to a refusal, `/api/hub/ask` has silently become a second
    // cite-or-refuse route and the golden rule is broken.
    expect(MIRA_AUGMENTED).toContain("never a refusal");
    expect(MIRA_AUGMENTED).toContain("give the general answer anyway");
  });

  it("general mode reasons broadly without requiring evidence", () => {
    expect(MIRA_GENERAL).toContain("that is exactly what is wanted here");
    expect(MIRA_GENERAL).toContain("Do not refuse a question that general engineering knowledge can answer");
  });

  it("no mode permits fabricated model-specific values", () => {
    expect(MIRA_GROUNDED).toContain("never invent a correction");
    expect(MIRA_AUGMENTED).toContain("Do NOT invent machine-specific facts");
    expect(MIRA_GENERAL).toContain("UNSUPPORTED SPECIFICS rule above is fully in force");
  });

  it("each mode contributes its own evidence block and no other", () => {
    expect(buildMiraSystemPrompt("grounded")).toContain(MIRA_GROUNDED);
    expect(buildMiraSystemPrompt("grounded")).not.toContain(MIRA_GENERAL);
    expect(buildMiraSystemPrompt("general")).toContain(MIRA_GENERAL);
    expect(buildMiraSystemPrompt("general")).not.toContain(MIRA_GROUNDED);
    expect(buildMiraSystemPrompt("augmented")).toContain(MIRA_AUGMENTED);
    expect(buildMiraSystemPrompt("augmented")).not.toContain(MIRA_GROUNDED);
  });
});

describe("MIRA contract — unsupported specifics (§3.1, the hedge loophole)", () => {
  it.each(MODES)("%s mode carries the shared unsupported-specifics rule", (mode) => {
    expect(buildMiraSystemPrompt(mode)).toContain("UNSUPPORTED SPECIFICS");
  });

  it("names every identity class a hedge used to launder", () => {
    // The A/B caught the contract guessing what P042 MEANS behind "typically".
    // The rule has to name the whole class, not the one instance that was seen.
    for (const claim of [
      "what a numbered parameter is or does",
      "what a fault or error code means",
      "which terminal or pin carries which signal",
      "a default or required setting",
      "a torque figure",
      "a part number",
    ]) {
      expect(MIRA_CORE).toContain(claim);
    }
  });

  it("closes the hedge loophole explicitly, by name", () => {
    expect(MIRA_CORE).toContain('do not launder a guess through "typically"');
    expect(MIRA_CORE).toContain('"usually", "generally" or "often"');
    expect(MIRA_CORE).toContain("A hedged invention is still an invention");
  });

  it("withholds the identifier WITHOUT withholding the engineering", () => {
    // The failure mode in the other direction: a rule so broad MIRA stops
    // explaining anything. The general explanation must stay explicitly allowed.
    expect(MIRA_CORE).toContain("This never restricts the general explanation");
    expect(MIRA_CORE).toContain("Withhold the unsupported IDENTIFIER, never the engineering");
  });

  it("the old 'say what it typically is' instruction is gone from general mode", () => {
    expect(MIRA_GENERAL).not.toContain("Say what it typically is");
  });
});

describe("MIRA contract — no mandatory template (§2)", () => {
  it.each(MODES)("%s mode states no hard word count", (mode) => {
    expect(buildMiraSystemPrompt(mode)).not.toMatch(/under about \d+ words|under \d+ words/);
  });

  it("no mode mandates a bullet quota", () => {
    expect(MIRA_AUGMENTED).not.toContain("4-8 short bullets max");
    expect(MIRA_GENERAL).not.toContain("under about 150 words");
  });

  it("format is explicitly told to follow the question", () => {
    expect(MIRA_CORE).toContain("there is no fixed template");
    expect(MIRA_CORE).toContain("Do NOT force every answer into bullets");
  });
});

describe("MIRA contract — augmented must USE retrieved evidence (staging regression)", () => {
  // Live staging acceptance run 35750048153, scenario 3: a technician attached a
  // manual, retrieval returned the chunk, the chunk reached the provider — and
  // the answer shipped ZERO citations badged "General guidance — not grounded in
  // this machine's documents." Augmented was answering AROUND evidence that was
  // right in front of it, which is the exact inverse of the golden rule.
  it("tells the model to lead with and cite retrieved excerpts", () => {
    expect(MIRA_AUGMENTED).toContain("USE THE EVIDENCE YOU WERE GIVEN");
    expect(MIRA_AUGMENTED).toContain("Lead with what they support and cite it");
  });

  it("forbids telling a technician their documents miss when an excerpt speaks to it", () => {
    expect(MIRA_AUGMENTED).toContain("never tell a technician their documents do not cover something");
    expect(MIRA_AUGMENTED).toContain("they attached that manual on purpose");
  });

  it("treats partial coverage as coverage rather than an excuse to go general", () => {
    expect(MIRA_AUGMENTED).toContain("Partial coverage is still coverage");
    expect(MIRA_AUGMENTED).toContain(
      'only true when nothing in CONTEXT speaks to the question at all',
    );
  });

  it("still permits a general answer when CONTEXT genuinely has nothing", () => {
    // The fix must not swing into the opposite failure — a cite-or-refuse
    // augmented mode would re-create the dead end this whole change removed.
    expect(MIRA_AUGMENTED).toContain("never a refusal");
    expect(MIRA_AUGMENTED).toContain("give the general answer anyway");
  });
});

describe("MIRA contract — safety posture (§4)", () => {
  it.each(MODES)("%s mode carries the energy-state rule", (mode) => {
    // Before the contract this rule existed in ONE of nine Hub surfaces. The
    // point of a shared core is that every mode now inherits it.
    const p = buildMiraSystemPrompt(mode);
    expect(p).toContain("ENERGY STATE");
    expect(p).toContain("IN THE SAME SENTENCE as the instruction");
  });

  it.each(MODES)("%s mode ranks isolation above brevity", (mode) => {
    expect(buildMiraSystemPrompt(mode)).toContain(
      "Never omit that clause to keep the answer short",
    );
  });

  it("safety posture is prose, never a gate — no stop/refuse verdict lives here", () => {
    // §4.3: matchSafetyStop is the gate and runs before retrieval and before any
    // provider call. Prose here must never be mistaken for it.
    expect(MIRA_CORE).not.toContain("SAFETY STOP");
    expect(MIRA_CORE).not.toContain("⛔");
  });
});

describe("MIRA contract — extensions may extend, not redefine (§6)", () => {
  it("an extension is appended after the core, never before it", () => {
    const p = buildMiraSystemPrompt("augmented", "SCOPE — extra task rules.");
    expect(p.indexOf(MIRA_CORE)).toBeLessThan(p.indexOf("SCOPE — extra task rules."));
    expect(p.startsWith("You are MIRA")).toBe(true);
  });

  it("an empty or whitespace extension changes nothing", () => {
    const plain = buildMiraSystemPrompt("grounded");
    expect(buildMiraSystemPrompt("grounded", "")).toBe(plain);
    expect(buildMiraSystemPrompt("grounded", "   \n  ")).toBe(plain);
  });
});

describe("MIRA contract — provider independence (§7)", () => {
  it("the prompt is a pure function of mode and extension", () => {
    // Persona is a property of the contract, not the provider. A cascade
    // fallback (Groq → Cerebras → Together) must not change who MIRA is, so the
    // builder must not read provider state, env, clock or randomness.
    for (const mode of MODES) {
      expect(buildMiraSystemPrompt(mode)).toBe(buildMiraSystemPrompt(mode));
    }
    const src = buildMiraSystemPrompt.toString();
    expect(src).not.toMatch(/process\.env|Date|Math\.random|fetch|provider/i);
  });

  it("no mode text names a provider or model", () => {
    for (const block of [MIRA_CORE, MIRA_GROUNDED, MIRA_AUGMENTED, MIRA_GENERAL]) {
      expect(block).not.toMatch(/groq|cerebras|together|gemini|gpt-oss|llama/i);
    }
  });
});
