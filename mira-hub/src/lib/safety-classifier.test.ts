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
  detectEnergizedElectricalHazardIntent,
  safetyFlagHeaders,
  withSafetyFlag,
  LETHAL_VOLTAGE_CONTEXT,
  ENERGIZED_WORK_INTENT,
  hazardBanner,
  isEnergizedWorkAsk,
  notebookSafetyTrigger,
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

// 2026-10-17 prod-test item 2 — TQ-30: "locking out" / "locked out" never
// matched because guardrails.py only carries the noun forms ("lockout tagout",
// "lockout/tagout", "loto"). The verb forms are Hub-side additions (the
// transcription list stays byte-identical to guardrails.py).
describe("lockout verb forms (TQ-30) — notebook surface only", () => {
  it.each([
    "do I need to be locking out the drive before changing the belt?",
    // A leading "the " was read as an educational framing by the parity-pinned
    // EDUCATIONAL_QUESTION_PATTERN; the verb branch now takes the narrower
    // DEFINITIONAL_RE, so a real report flags.
    "the conveyor is locked out, can I reach in and clear the jam?",
    "conveyor is locked out, can I reach in and clear the jam?",
    "should I lock out the VFD first",
    "lock it out before you pull the cover?",
    "Lock-out the panel then swap the contactor",
  ])("flags (banner, never a stop): %s", (msg) => {
    expect(notebookSafetyTrigger(msg)).not.toBeNull();
  });

  it("the matched text drives the isolation banner, not the generic fallback", () => {
    const trigger = notebookSafetyTrigger("the conveyor is locked out, can I reach in and clear the jam?");
    expect(hazardBanner(trigger!)).toMatch(/Isolation/);
    expect(hazardBanner("locking out")).toMatch(/Isolation/);
  });

  it("educational framings stay unstopped (control)", () => {
    expect(notebookSafetyTrigger("What is locking out a machine?")).toBeNull();
    expect(notebookSafetyTrigger("Explain locked out tagged out")).toBeNull();
  });

  it("'clock out' / 'block out' / 'lookout' are not lockout (word boundary control)", () => {
    expect(notebookSafetyTrigger("I clock out at five, can the PM wait")).toBeNull();
    expect(notebookSafetyTrigger("the lookout tower camera feed dropped")).toBeNull();
    expect(notebookSafetyTrigger("block out the light sensor with tape?")).toBeNull();
  });
});

// TQ-29: a hands-on ask on a POWERED machine is an energized-work ask — the
// route hard-stops it (energized-work-stop.ts) instead of answering under a
// banner. The classifier only decides WHICH asks qualify.
describe("isEnergizedWorkAsk (TQ-29)", () => {
  // The four phrasings the wide EDUCATIONAL_QUESTION_PATTERN exempted — every
  // one measured false before DEFINITIONAL_RE replaced it (2026-10-18). These
  // are the natural TQ-29 shapes: a procedural question is not educational.
  it.each([
    "How do I swap the cooling fan while it's powered?",
    "What torque on the cover screws while it's live?",
    "Is it OK to change the contactor without locking out?",
  ])("a procedural ask opening with how/what/is-it is energized work, not educational: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  it.each([
    "can I swap the cooling fan on the GS10 while it's powered? what torque on the cover screws",
    "replace the keypad while the drive is powered",
    "change the contactor without locking out the panel",
    "can I do this without lockout",
    "pull the fuse holder with the power on",
  ])("is energized work: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  it.each([
    "what does fault oC mean on the GS10",
    "how do I set the carrier frequency",
    // A reset is not hands-on work (answer-gate E13 relies on this streaming).
    "Can I reset while energized?",
    "is this a live wire or a signal wire",
    // An ACTIVE incident keeps its Tier-1 incident banner + answer (route tests
    // chat-electrical-hazard-directive / -live-stream pin the 09-27 precedence).
    "I just got shocked on the 480V feeder — can I clamp meter it while it's running?",
    // NOTE on the 480 V + meter conjunction: after Review A broadened the
    // powered-state vocabulary ("while running"), the CLASSIFIER now calls
    // those energized work — which is honest, because they are. The
    // owner-decided NFPA 70E directive still owns those turns, enforced at the
    // ROUTE (`!electricalHazardDirective`), and the directive suites
    // chat-electrical-hazard-directive / -live-stream pin that end-to-end.
    // So they are deliberately NOT asserted false here any more.
    // A Tier-1 phrase already earns the hazard banner + full answer (#4068/2i).
    "check the output terminals while live",
    "I need to work on the live panel to check it, what should I check",
    "the drive is locked out, how do I verify zero energy",
    "what is working live",
    "explain the lockout procedure",
    "is the power on light supposed to blink while running",
  ])("is NOT energized work (control): %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});

// ── Review A (Grok 4.6 via Cursor, 2026-10-18) HIGH findings ──
// The reviewer had the real TQ wording. The shipped detector returned FALSE
// for the actual TQ-29 string and for every phrasing below — verified on
// 0d28afad9. These are the real fixtures the earlier reconstructions should
// have been.
describe("Review A HIGH — the real TQ-29 phrasings must stop", () => {
  it.each([
    "How do I pull the RFI jumper with it powered?",
    "pull the RFI jumper with the drive powered",
    "swap it while running",
    "check it under power",
    "can I do it hot",
    "it is still hot, can I pull the cover",
    "replace the fan with the unit powered",
  ])("energized work: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  // Scope-pass fixes (2026-10-18): two gaps the challenge found by phrasing.
  // "while the power is still on" had no match — the list knew "with the
  // power on" and bare "power still on", but the `while … is` form fell
  // through. And "connector" was missing from the work objects, so a
  // verb-less ask about handling one under power walked past. Each measured
  // false on 24abb8e8a before the fix.
  it.each([
    "Can I replace the keypad while the power is still on?",
    "can I remove the cover while power is applied",
    "Is the connector safe to handle while it's powered?",
  ])("energized work (scope-pass gap): %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  // Broadening "while running" / "hot" risks over-triggering on ordinary
  // diagnostics, so each one gets a harmless twin that must NOT stop.
  it.each([
    "check the fault log while running",
    "the motor is running hot, what should I check",
    "is the run light supposed to be on while running",
    "what does it mean when the drive runs hot",
    "the bearing is hot to the touch, what causes that",
  ])("control, ordinary diagnostic: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});

// ── Round 2 (Grok via Cursor, 2026-10-18, on fb5fc6447) ──
// Two false positives and eleven false negatives, each reproduced on that head
// before the fix. "sous tension" / "unter Spannung" are NOT fixed: the detector
// is English-only, and that is a documented limit, not a gap in the list.
describe("Round 2 — status reports are diagnosis, not energized work (false positives)", () => {
  it.each([
    // Reproduced TRUE on fb5fc6447 — the stop fired on "check"+"keypad" and on "fan".
    "with the drive powered up, the keypad shows oL, what do I check?",
    "fan running while powered, is that normal?",
    // Already false on fb5fc6447 — kept as regression controls.
    "Under power-loss conditions, what does the drive do with the output?",
    "what does the connector LED mean while running",
    "is the power supposed to stay on while the connector is seated",
    "the display reads F004 with it powered, what does that indicate",
  ])("diagnosis, not a stop: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });

  it.each([
    // A status report that ALSO asks for hands-on work still stops — the
    // physical verb wins over the diagnostic marker.
    "the keypad shows oL with the drive powered up, can I pull the cover and swap the fan?",
    "it reads F004, swap the relay while it's powered",
    // An explicit lockout skip wins over everything.
    "the display shows oL — can I do it without locking out?",
  ])("control: a status report that asks for hands-on work still stops: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });
});

describe("Round 2 — live-work phrasings that were still being answered (false negatives)", () => {
  it.each([
    "pull the RFI jumper hot",
    "can I touch the live bus",
    "pull the RFI jumper without killing power",
    "keep it running and swap the fan",
    "pull the jumper while its powered",
    "hot-swap the module",
    "I can't shut the line down. How do I pull the RFI jumper?",
    "swap the fan without shutting it down",
    "replace the relay without de-energizing",
    "pull the card before I kill power",
  ])("energized work: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  it.each([
    // The "<verb> it hot" form must not catch temperature talk.
    "the motor is running hot, what should I check",
    "the bearing is hot to the touch, what causes that",
    // "keep it running" is a weak state: a reading verb alone is not a stop.
    "keep it running and check the fault log",
    // "under power-loss" is not "under power".
    "under power-loss conditions the drive coasts, is that expected",
  ])("control: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});

// ── Round 3 (Codex adversarial review on 19b536817, 2026-10-18) ──
describe("Codex F1 — a definitional OPENER does not make a definitional ask", () => {
  it.each([
    "Explain how to pull the RFI jumper with it powered",
    "What is the torque on the cover screws while it is powered?",
    "Describe how to replace the fan without locking out",
    "Tell me how to swap the relay while its powered",
    "What is the right way to pull the jumper with it powered?",
    // round 2 variants — the opener list lost; intent wins
    "Explain how I can pull the RFI jumper with it powered",
    "Describe replacing the fan without locking out",
    "What do I need to pull the RFI jumper with it powered?",
    "What are the steps for swapping the contactor with the power on",
    // round 3 — an explicit lockout bypass with NO verb/object is still a stop
    "Explain how to bypass the lockout",
    "Explain how I can do this without locking out",
    "What is the trick to skipping LOTO on this one?",
  ])("procedural, stops: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });

  // Codex round 4 — the copula and the skip-isolation wording were enumerated.
  it.each([
    "Can I remove the cover while the drive remains energized?",
    "Can I replace the fan while the VFD stays powered?",
    "Can I pull the jumper with the machine turned on?",
    "pull the card with the unit switched on",
    "swap the belt when the motor is kept running",
    "Can I pull the jumper before shutting the power off?",
    "swap the relay without doing lockout",
    "replace the fuse without performing LOTO",
    "change the contactor before powering it down",
  ])("round-4 wording, stops: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });
  it.each([
    "explain the lockout procedure",
    "what is working live",
    "what does lockout tagout mean",
    "what is LOTO",
    "describe the keypad layout",
    "what is the carrier frequency parameter",
    "explain what powered means on the status screen",
    // round-4 controls: state words in a diagnostic, not a work ask
    "the drive remains energized after the stop command, is that normal",
    "turn the machine on and check the display",
    "is the VFD supposed to stay powered when the door opens",
    "can I run it with the cover on",
  ])("control, definitional: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});

describe("Codex F2 — a symptom sentence does not make powered contact observation-only", () => {
  it.each([
    "Can I measure the terminals with it powered?",
    "The display reads F004; can I measure the terminals with it powered?",
    "The LED blinks; can I probe the connector with it powered?",
    "it shows oL — check the bus bar with it powered?",
    // round 2 variants — a quantity and a preposition between verb and object
    "The display reads F004; can I measure voltage across the terminals with it powered?",
    "The LED blinks; can I probe voltage at the connector with it powered?",
    "It reads oC. Can I check continuity on the output terminals while it's powered?",
    // round 3 — no proximity window: a long measurement phrase still counts
    "The display reads F004; can I measure the voltage between the two output terminals with it powered?",
    "The LED blinks. Can I meter the DC bus voltage at the terminals on the bottom of the unit with it powered?",
  ])("contact with a work object, stops: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(true);
  });
  it.each([
    "with the drive powered up, the keypad shows oL, what do I check?",
    "the display reads F004 with it powered, what does that indicate",
    "check the fault log while running",
    "the display reads 480 volts with it powered, is that normal?",
    "the keypad shows the DC bus voltage while running, is that the right reading",
  ])("control, observation only: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
});

describe("Codex F3 — powered off / powered down is the SAFE state", () => {
  it.each([
    "How do I pull the RFI jumper with it powered off?",
    "How do I pull the RFI jumper with it powered down?",
    "swap the fan while it's powered down",
    // round 2 variants — the standalone "still powered" alternative and the hyphen
    "How do I pull the RFI jumper with it still powered off?",
    "How do I pull the RFI jumper with it still powered down?",
    "How do I pull the RFI jumper with it powered-off?",
    "it is still powered-down, can I swap the fan",
  ])("not energized work: %s", (msg) => {
    expect(isEnergizedWorkAsk(msg)).toBe(false);
  });
  it.each(["How do I pull the RFI jumper with it powered?", "pull the jumper with it powered up", "swap the fan while it's powered on"])(
    "control, still stops: %s",
    (msg) => {
      expect(isEnergizedWorkAsk(msg)).toBe(true);
    },
  );
});

// TQ-30: the goal asked for these to be FLAGGED, not stopped — a request for
// the lockout procedure is the safe path and must still be answered. The
// trigger now comes from the notebook-only wrapper so the other two chat
// routes stay byte-identical to base (Review A MEDIUM, over-trigger).
describe("Review A — lockout forms flag on the notebook surface only", () => {
  it.each([
    "walk me through locking out the M340",
    "lockout",
    "lockout procedure for this press",
    "I locked it out",
    "the conveyor is locked out, can I reach in and clear the jam?",
  ])("notebookSafetyTrigger flags: %s", (msg) => {
    expect(notebookSafetyTrigger(msg)).not.toBeNull();
  });

  it("a lockout PROCEDURE request is flagged but never an energized-work stop", () => {
    const q = "walk me through locking out the M340";
    expect(notebookSafetyTrigger(q)).not.toBeNull();
    expect(isEnergizedWorkAsk(q)).toBe(false);
  });

  it("the shared matcher is unchanged, so NodeChat and asset chat do not newly banner", () => {
    // Review A MEDIUM: this exact message was bannering on all three surfaces.
    expect(matchSafetyStop("We locked out the MCC yesterday, what's Addr_CAN_OB?")).toBeNull();
    expect(matchSafetyStop("walk me through locking out the M340")).toBeNull();
    expect(matchSafetyStop("how do I lock out this conveyor")).toBeNull();
    // …while the Tier-1 transcription list still behaves exactly as before.
    expect(matchSafetyStop("lockout tagout procedure")).not.toBeNull();
    expect(matchSafetyStop("there are exposed wires near the panel")).not.toBeNull();
  });
});
