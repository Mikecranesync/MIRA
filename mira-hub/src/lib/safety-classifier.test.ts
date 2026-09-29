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
  SAFETY_PHRASES_IMMEDIATE,
  EDUCATIONAL_QUESTION_PATTERN,
  matchSafetyStop,
  IMPROVISED_LOCKOUT,
  ENERGIZED_ELECTRICAL_HAZARD,
  hazardBanner,
  flagDirectiveFor,
  improvisedLockoutAddendum,
  detectEnergizedElectricalHazardIntent,
  safetyFlagHeaders,
  withSafetyFlag,
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

  it("a Modbus parameter read is not energized work (word boundary, benchmark Q01)", () => {
    // "modbus" contains "bus" and "parameter" contains "meter"; substring matching
    // hard-stopped this ordinary question on the public quickstart.
    const msg = "How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?";
    expect(detectEnergizedElectricalHazardIntent(msg)).toBe(false);
    expect(matchSafetyStop(msg)).toBeNull();
  });

  it("the standalone words still trigger (control for the word-boundary rule)", () => {
    expect(
      detectEnergizedElectricalHazardIntent("Can I check the bus with a meter while it's live?"),
    ).toBe(true);
    expect(
      detectEnergizedElectricalHazardIntent("480V busbar: I'll probe it while running."),
    ).toBe(true);
     // Review of #4036: compound meter names and glued voltages must still count.
    for (const msg of [
      "480V bus is hot, grabbing my voltmeter now.",
      "clampmeter on the 480V feeder while it's running",
      "ammeter reading on the MCC bucket",
      "3ph480v feeder, measure it while live",
    ]) {
      expect(detectEnergizedElectricalHazardIntent(msg), msg).toBe(true);
    }
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

describe("withSafetyFlag / safetyFlagHeaders (every outcome of a flagged turn shows the banner)", () => {
  it("prefixes the hazard banner only when there is a trigger", () => {
    expect(withSafetyFlag("Try again in a minute.", "smoke coming")).toMatch(/^⚠️ \*\*Possible active incident.*\n\nTry again in a minute\.$/s);
    expect(withSafetyFlag("Try again in a minute.", null)).toBe("Try again in a minute.");
    expect(safetyFlagHeaders("smoke coming")).toEqual({ "X-Safety-Flag": "smoke coming" });
    expect(safetyFlagHeaders(null)).toBeUndefined();
  });
});

describe("#4113: improvised lockout is a flag with its own banner and directive", () => {
  const Q2 =
    "The gate still operates in either position. People use it as a lockout; with the regulator off in one position, they can push the shotgun gate. What position should I leave it in?";

  it.each([
    Q2,
    "We use the red knob as our lockout on the gates.",
    "Is it ok to lockout with the regulator instead?",
    "They rely on the push-lock button as a lock out.",
    "Operators use the valve instead of lockout.",
    "With the air off we just push the gate open by hand.",
    "After the pressure is bled we move the clamp manually.",
  ])("flags: %s", (q) => {
    expect(matchSafetyStop(q)).toBe(IMPROVISED_LOCKOUT);
    expect(hazardBanner(IMPROVISED_LOCKOUT)).toMatch(/Not a lockout unless your procedure says so/);
    expect(flagDirectiveFor(IMPROVISED_LOCKOUT)).toMatch(/NOT a\s+personnel\s+lockout/);
  });

  it.each([
    "How do I perform lockout tagout?",
    "Lock out the air supply valve at the FRL before replacing the cylinder.",
    "What is the red button?",
    "The regulator is set to 6 bar and the gate moves slowly.",
  ])("does not flag a genuine lockout question or an ordinary one: %s", (q) => {
    expect(matchSafetyStop(q)).not.toBe(IMPROVISED_LOCKOUT);
  });
});


describe("#4114 review: precedence and manual movement", () => {
  const Q2 =
    "The gate still operates in either position. People use it as a lockout; with the regulator off in one position, they can push the shotgun gate. What position should I leave it in?";

  it("a trailing 'safe to work' keeps its trigger AND carries the lockout restrictions (F1)", () => {
    const msg = `${Q2} Is it safe to work?`;
    const t = matchSafetyStop(msg);
    expect(t).toBe("safe to work");
    expect(flagDirectiveFor(t!, msg)).toMatch(/NOT a\s+personnel\s+lockout/);
  });

  it("an active incident keeps its trigger and still carries the lockout restrictions", () => {
    const msg = `${Q2} There is smoke coming from the valve.`;
    expect(matchSafetyStop(msg)).toBe("smoke coming");
    expect(flagDirectiveFor("smoke coming", msg)).toMatch(/NOT a\s+personnel\s+lockout/);
  });

  it("'safe to work' alone is still flagged as before", () => {
    expect(matchSafetyStop("Is it safe to work on the gate?")).toBe("safe to work");
  });

  it.each([
    "With the air supply off, the cylinder moves slowly. Why?",
    "When the pressure is vented the gate drifts open and moves down.",
    "The regulator is off and the actuator still moves.",
  ])("equipment moving on its own is not an improvised lockout (F2): %s", (q) => {
    expect(matchSafetyStop(q)).not.toBe(IMPROVISED_LOCKOUT);
  });

  it.each([
    "With the air off we just push the gate open by hand.",
    "Once the regulator is off, operators pull the clamp back.",
    "With the pressure bled, the gate can be moved manually.",
  ])("a person moving it after air-off still flags: %s", (q) => {
    expect(matchSafetyStop(q)).toBe(IMPROVISED_LOCKOUT);
  });
});


describe("#4114 review round 2: composition and approved lockout equipment", () => {
  it("an energized-electrical question keeps the NFPA 70E directive and gains the lockout one (F1)", () => {
    const msg = "We use the red knob as our lockout on the gates. Can I measure voltage on the 480V feeder while energized?";
    const t = matchSafetyStop(msg);
    expect(t).toBe(ENERGIZED_ELECTRICAL_HAZARD);
    const d = flagDirectiveFor(t!, msg);
    expect(d).toContain("Qualified Person");
    expect(d).toMatch(/NOT a\s+personnel\s+lockout/);
  });

  it("no addendum when the message has no improvised lockout", () => {
    expect(flagDirectiveFor("safe to work", "Is it safe to work on the gate?")).not.toMatch(/personnel\s+lockout/);
    expect(improvisedLockoutAddendum("Is it safe to work on the gate?", "safe to work")).toBe("");
  });

  it.each([
    "We use a padlock on the approved disconnect as our lockout. How do I verify zero energy?",
    "We use the main breaker as our lockout point with a personal lock.",
    "Our procedure uses a lockable isolation point as the lockout for the air supply.",
  ])("approved lockout equipment is not improvised (F5): %s", (q) => {
    expect(matchSafetyStop(q)).not.toBe(IMPROVISED_LOCKOUT);
  });
});


describe("#4114 review round 3: approved isolation valves are not improvised", () => {
  it.each([
    "We use the approved lockable isolation valve as our lockout, with a personal padlock. How do I verify zero energy?",
    "We use the isolation valve as our lockout point and hang a padlock on it.",
  ])("not flagged: %s", (q) => {
    expect(matchSafetyStop(q)).not.toBe(IMPROVISED_LOCKOUT);
  });

  it.each([
    "We use the control valve as our lockout on the gates.",
    "Operators use the regulator as a lockout.",
  ])("an ordinary control valve or regulator is still flagged: %s", (q) => {
    expect(matchSafetyStop(q)).toBe(IMPROVISED_LOCKOUT);
  });
});
