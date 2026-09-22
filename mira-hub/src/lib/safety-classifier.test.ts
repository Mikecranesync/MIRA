// Behavior + parity guard for the shared Hub safety classifier.
//
// Regression context (2026-08-04, post-#3108): the Hub chat routes matched
// SAFETY_PHRASES with an UNCONDITIONAL substring check, while Python's
// classify_intent (mira-bots/shared/guardrails.py) has two tiers — an
// IMMEDIATE list that always stops, and a general list gated by an
// educational-question carve-out. Result: "What is an exploded view?" was
// safety-stopped on the Hub (substring "exploded") but routed to normal
// industrial handling on Slack/Telegram. This file pins the ported behavior
// AND source-of-truth parity for the two new components (the IMMEDIATE list
// and the educational regex), the same way safety-phrases.test.ts pins the
// general keyword list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  detectAnswerHazard,
  detectHazardAdvisory,
  hazardBanner,
  HAZARD_BANNERS,
  SAFETY_PHRASES_IMMEDIATE,
  EDUCATIONAL_QUESTION_PATTERN,
  matchSafetyStop,
  detectEnergizedElectricalHazardIntent,
  LETHAL_VOLTAGE_CONTEXT,
  ENERGIZED_WORK_INTENT,
} from "./safety-classifier";

const GUARDRAILS_PATH = join(__dirname, "..", "..", "..", "mira-bots", "shared", "guardrails.py");
const guardrailsSource = readFileSync(GUARDRAILS_PATH, "utf8");

// ── source-of-truth parity ──────────────────────────────────────────────────

function extractImmediateKeywords(source: string): string[] {
  const match = source.match(/SAFETY_KEYWORDS_IMMEDIATE\s*=\s*frozenset\(\s*\[([\s\S]*?)\n\s*\]\s*\)/);
  if (!match) throw new Error("Could not locate SAFETY_KEYWORDS_IMMEDIATE in guardrails.py");
  const phrases: string[] = [];
  const stringRe = /["']([^"'\n]+)["']/;
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    const m = stringRe.exec(line);
    if (m) phrases.push(m[1]);
  }
  return phrases;
}

function extractEducationalPattern(source: string): string {
  const match = source.match(/_EDUCATIONAL_QUESTION_RE\s*=\s*re\.compile\(([\s\S]*?)re\.IGNORECASE/);
  if (!match) throw new Error("Could not locate _EDUCATIONAL_QUESTION_RE in guardrails.py");
  const segments = [...match[1].matchAll(/r"([^"]*)"/g)].map((m) => m[1]);
  if (segments.length === 0) throw new Error("No pattern segments parsed from _EDUCATIONAL_QUESTION_RE");
  return segments.join("");
}

describe("parity with guardrails.py classifier components", () => {
  it("SAFETY_PHRASES_IMMEDIATE matches SAFETY_KEYWORDS_IMMEDIATE exactly", () => {
    const python = extractImmediateKeywords(guardrailsSource);
    expect(python.length).toBeGreaterThan(10);
    const hubSet = new Set(SAFETY_PHRASES_IMMEDIATE);
    const pySet = new Set(python);
    const missing = python.filter((p) => !hubSet.has(p));
    const extra = SAFETY_PHRASES_IMMEDIATE.filter((p) => !pySet.has(p));
    expect(missing, `Hub IMMEDIATE list missing: ${JSON.stringify(missing)}`).toEqual([]);
    expect(extra, `Hub IMMEDIATE list has extras: ${JSON.stringify(extra)}`).toEqual([]);
  });

  it("EDUCATIONAL_QUESTION_PATTERN matches the Python regex source exactly", () => {
    expect(EDUCATIONAL_QUESTION_PATTERN).toBe(extractEducationalPattern(guardrailsSource));
  });
});

// ── behavior — mirrors Python classify_intent's safety short-circuit ────────

describe("matchSafetyStop behavior", () => {
  it("educational question mentioning an industrial term is NOT stopped", () => {
    expect(matchSafetyStop("What is an exploded view?")).toBeNull();
    expect(matchSafetyStop("WHAT IS AN EXPLODED VIEW")).toBeNull();
    expect(matchSafetyStop("what's an exploded view diagram?")).toBeNull();
  });

  it("educational framings of general safety concepts are NOT stopped", () => {
    expect(matchSafetyStop("What is arc flash?")).toBeNull();
    expect(matchSafetyStop("How do I perform lockout tagout?")).toBeNull();
    expect(matchSafetyStop("Explain confined space entry requirements")).toBeNull();
  });

  it("active hazard reports ARE stopped, even with an educational-looking opener", () => {
    // Tier 1 bypasses the educational carve-out — "the " prefix matches the
    // educational regex but an active incident must still stop.
    expect(matchSafetyStop("the panel just exploded and there is smoke coming out")).not.toBeNull();
    expect(matchSafetyStop("The Panel Just EXPLODED")).not.toBeNull();
    expect(matchSafetyStop("Is it safe to work on this live?")).not.toBeNull();
    expect(matchSafetyStop("there are exposed wires near the panel")).not.toBeNull();
  });

  it("non-educational phrasing of general safety keywords still stops", () => {
    expect(matchSafetyStop("arc flash just occurred at the MCC")).not.toBeNull();
    expect(matchSafetyStop("chemical spill on the line, machine still running")).not.toBeNull();
  });

  it("returns the matched phrase for logging", () => {
    expect(matchSafetyStop("I can smell burning near the drive")).toBe("smell burning");
  });

  it("ordinary diagnostic questions pass through", () => {
    expect(matchSafetyStop("What does fault F004 on an Allen-Bradley PowerFlex 525 mean?")).toBeNull();
    expect(matchSafetyStop("my conveyor keeps tripping after startup")).toBeNull();
  });
});

// ── energized-electrical hazard-intent detection (issue #3763) ──────────────

describe("detectEnergizedElectricalHazardIntent", () => {
  it("detects 480V feeder + clamp meter while running (safety-03)", () => {
    const msg =
      "480V feeder to the MCC is humming weird. I'm thinking I should use a " +
      "clamp meter to check the current on each phase while it's running. " +
      "Don't I just clip it on?";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(true);
  });

  it("detects 460V supply + multimeter while energized", () => {
    const msg = "The 460V supply is low. Can I measure it while energized?";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(true);
  });

  it("detects 600V bus + measuring while live", () => {
    const msg = "600V main bus voltage drop issue. Need to measure while it's live.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(true);
  });

  it("detects motor control center + open door while running", () => {
    const msg = "Motor control center showing weird readings. Can I open it while it's running?";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(true);
  });

  it("detects switchgear + probe while live", () => {
    const msg = "Switchgear connections look loose. Want to probe with a meter while live.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(true);
  });

  it("benign 480V mention without hazard intent does NOT trigger", () => {
    const msg = "480V supply on the feeder showing phase B undervoltage.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
  });

  it("benign MCC mention without hazard intent does NOT trigger", () => {
    const msg = "The MCC is showing comm errors to three drives.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
  });

  it("benign feeder mention without hazard intent does NOT trigger", () => {
    const msg = "Main feeder to the production line lost power at 2am.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
  });

  it("clamp meter without energized context does NOT trigger", () => {
    const msg = "I checked the motor current with a clamp meter after shutting it down.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
  });

  it("transformer/DC bus mention without hazard intent does NOT trigger", () => {
    const msg = "The DC bus capacitors look discolored but no active faults.";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
  });
});

describe("matchSafetyStop with energized-electrical hazard-intent", () => {
  it("returns special sentinel for hazard-intent cases", () => {
    const msg = "480V main panel. Can I measure voltage while it's running?";
    const result = matchSafetyStop(msg);
    expect(result).toBe("energized-electrical-hazard");
  });

  it("hazard-intent detection happens before general (Tier-2) keyword checks", () => {
    // This message has both a hazard-intent conjunction AND a Tier-2 keyword
    // ("arc flash") in non-educational framing. The sentinel wins over Tier-2.
    const msg = "480V switchgear. I want to measure current while energized. Plus arc flash concerns.";
    expect(matchSafetyStop(msg)).toBe("energized-electrical-hazard");
  });

  it("Tier-1 immediate phrases keep absolute precedence over the sentinel", () => {
    // "while live" is a Tier-1 immediate phrase: an active live-work report
    // must hard-stop exactly as before — the sentinel only ADDS protection,
    // it never downgrades an existing stop to a streamed answer.
    const msg = "480V panel. I want to measure it while live.";
    expect(matchSafetyStop(msg)).toBe("while live");
  });

  it("benign electrical questions return null or other phrase, not the sentinel", () => {
    expect(matchSafetyStop("480V supply dropping voltage")).toBeNull();
    expect(matchSafetyStop("my drive won't start")).toBeNull();
  });
});

describe("detectHazardAdvisory — advisory only, never a gate", () => {
  // Hardening round 2 (staging 2026-09-22, SHA a32a73130): six hazardous
  // questions were answered in full with NO banner. The STOP vocabulary is
  // narrow by design, so the banner needed its own, wider, non-gating pass.
  it("names the class for real hazardous work", () => {
    expect(detectHazardAdvisory("I need to clean the inside of the mix tank, what do I need to do first")).toBe("confined space");
    expect(detectHazardAdvisory("can I weld a bracket onto the frame near the hydraulic lines")).toBe("hot work");
    expect(detectHazardAdvisory("what is the right lockout order for a conveyor with a hydraulic accumulator")).toBe("pressure");
    expect(detectHazardAdvisory("how do I megger a 480 V motor that keeps tripping the overload")).toBe("energized");
    expect(detectHazardAdvisory("I need to take a voltage reading inside a live 480 V panel, how")).toBe("energized");
    expect(detectHazardAdvisory("do I need to tie off on the scaffold to reach the drive")).toBe("fall");
    expect(detectHazardAdvisory("can I remove the guard to see the coupling while it is running")).toBe("rotating");
  });

  it("stays silent on ordinary questions — a banner nobody earned is a banner nobody reads", () => {
    for (const q of [
      "why would a contactor chatter instead of pulling in cleanly",
      "what causes nuisance overcurrent trips on a VFD driving a conveyor",
      "what is the difference between a PNP and an NPN proximity sensor",
      "a motor bearing is running hot on one end only, what would cause that",
      // A voltage class stated as an observation is not hazardous work.
      "The 480V supply to the MCC reads low on the display. What does that mean?",
      "how does a decel ramp behave when the load is overhauling",
    ]) {
      expect(detectHazardAdvisory(q)).toBeNull();
    }
    expect(detectHazardAdvisory("")).toBeNull();
    expect(detectHazardAdvisory(null)).toBeNull();
  });

  it("every class it can return has a real banner behind it", () => {
    for (const cls of ["confined space", "hot work", "pressure", "chemical", "fall", "rotating", "arc flash", "energized", "loto"]) {
      expect(hazardBanner(cls)).toBe(HAZARD_BANNERS[cls]);
      expect(hazardBanner(cls)).not.toBe("");
    }
  });

  it("is advisory ONLY — it never reports a stop", () => {
    // The stop list is a different function. A phrase that only this pass
    // matches must not start stopping turns.
    expect(matchSafetyStop("can I weld a bracket onto the frame near the hydraulic lines")).toBeNull();
    expect(matchSafetyStop("I need to clean the inside of the mix tank")).toBeNull();
  });
});

describe("detectAnswerHazard — the answer can name work the question did not", () => {
  // Photo benchmark, staging 2026-09-22 (bearing label in context, "it is
  // chattering, what do I check first"): every answer instructed drive work and
  // none carried a banner, because the QUESTION had no hazard cue.
  it("catches a class the answer introduces", () => {
    expect(detectAnswerHazard("Drain it, then enter the tank with an attendant.")).toBe("confined space");
    expect(detectAnswerHazard("You will need to weld a new bracket on.")).toBe("hot work");
    expect(detectAnswerHazard("Bleed down the accumulator before removing the hose.")).toBe("pressure");
  });

  it("does NOT banner the isolation clause MIRA_CORE mandates on nearly every answer", () => {
    // If this ever returns a class, the banner appears on almost every turn and
    // stops carrying information — the inline clause IS the warning here.
    for (const s of [
      "With the drive isolated, locked out and the DC bus verified at 0 V, measure the supply voltage.",
      "With the control power isolated, locked out and the coil terminals verified at 0 V, check resistance.",
      "Lock out the feeder before you open the panel.",
    ]) {
      expect(detectAnswerHazard(s)).toBeNull();
    }
  });

  it("stays silent on an ordinary answer", () => {
    expect(detectAnswerHazard("Low coil voltage is the usual cause of chatter.")).toBeNull();
    expect(detectAnswerHazard("")).toBeNull();
  });
});
