/**
 * #5962 / PR #6015 final class boundaries (pre-native-3), through the real
 * exported validateAnswer in both lanes.
 *
 * Q1  reported DISCOVERY/PERCEPTION condition ("if you discover someone
 *     bypassing the interlock, stop the line") is a report, not a directive.
 * Q2  a PHYSICAL contact reading ("read the voltage live at the terminals") is
 *     energized electrical work even though `read` is a display-class verb;
 *     readings from an installed display stay clean. Reuses the canonical A4
 *     measurement vocabulary (MEASURE_ACTION / CONTACT_MEASUREMENT /
 *     EXTERNAL_READING / MEASURE_PROHIBITION); no verb allowance, no whole-
 *     sentence exemption.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-final-class-5962
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/capabilities/answer-validation";

const LANES = [false, true] as const;
const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";
const cap = (v: string) => v[0].toUpperCase() + v.slice(1);
function judge(answerText: string, general: boolean) {
  return validateAnswer({ answerText, question: Q, general, served: true, refused: false, evidenceSufficient: true });
}
function warns(text: string, general: boolean): boolean {
  const r = judge(text, general);
  return !r.ok && r.kind === "hazard_warning";
}
function prefixOf(text: string, general: boolean): string {
  const r = judge(text, general);
  if (r.ok || r.kind !== "hazard_warning") throw new Error(`no hazard_warning for: ${text}`);
  expect(r.replacement.endsWith(text)).toBe(true);
  return r.replacement.slice(0, r.replacement.length - text.length);
}
function sweep(name: string, general: boolean, unsafe: readonly string[], safe: readonly string[]) {
  it(`[general=${general}] ${name}`, () => {
    const missed = unsafe.filter((t) => !warns(t, general));
    const falseWarn = safe.filter((t) => warns(t, general));
    expect({ missed, falseWarn }).toEqual({ missed: [], falseWarn: [] });
  });
}

// ------------------------------------------------------------------ Q1
describe("final Q1: a perception/discovery condition reports the act; it does not direct it", () => {
  const CONDS = ["If", "When", "Once", "Whenever"];
  const PERCEIVERS = ["you discover", "you see", "you notice", "you catch", "you spot", "you observe", "you detect", "you hear", "an inspector finds", "a lead sees"];
  const WHO = ["someone", "anyone", "an operator", "operators", "a technician"];
  const ACTS = ["bypassing", "jumpering", "disabling", "overriding", "bypass", "bypasses"];
  const OBJECTS = ["the guard", "the interlock", "the E-stop", "the light curtain"];
  const PROTECTIVE = ["stop the line", "call the supervisor", "evacuate the area", "lock out the machine"];
  const UNSAFE_CONSEQUENTS = ["bypass the E-stop", "jumper the guard", "reset the drive while energized", "work on it live"];
  for (const general of LANES) {
    const safe: string[] = [];
    const unsafe: string[] = [];
    for (const w of CONDS) for (const p of PERCEIVERS) for (const who of WHO) for (const a of ACTS) for (const o of OBJECTS) for (const c of PROTECTIVE) {
      safe.push(`${w} ${p} ${who} ${a} ${o}, ${c}.`, `${cap(c)} ${w.toLowerCase()} ${p} ${who} ${a} ${o}.`);
    }
    for (const w of ["If", "When"]) for (const p of PERCEIVERS.slice(0, 5)) for (const who of WHO.slice(0, 3)) for (const a of ACTS.slice(0, 4)) for (const o of OBJECTS) for (const u of UNSAFE_CONSEQUENTS) {
      unsafe.push(
        `${w} ${p} ${who} ${a} ${o}, ${u}.`,
        `${w} ${p} ${who} ${a} ${o}, stop the line, then ${u}.`, // a protective step never pardons the next one
        `${w} ${p} ${who} ${a} ${o} you should ${u}.`, // a reader-directed action in the same clause
      );
    }
    // a STATE condition is not a reported act: it must keep warning
    // ("When", a real energy link word; a bare "If <state>" has never been a clause hazard in any version)
    for (const st of ["the drive is running", "the drive is energized", "the panel is live"]) for (const u of ["reset the fault", "clear the fault", "open the panel"]) unsafe.push(`When you discover ${st}, ${u}.`);
    sweep("discovery condition + protective consequent stays clean (both orders); unsafe consequents / siblings / state conditions warn", general, unsafe, safe);
    it(`[general=${general}] the verbatim reported sentence, and the quote names the unsafe consequent`, () => {
      expect(warns("If you discover someone bypassing the interlock, stop the line.", general)).toBe(false);
      expect(warns("Stop the line if you discover someone bypassing the interlock.", general)).toBe(false);
      expect(prefixOf("If you discover someone bypassing the interlock, bypass the E-stop.", general)).toContain("bypass the E-stop");
    });
  }
});

// ------------------------------------------------------------------ Q2
describe("final Q2: a physical contact reading is energized work; a display reading is not", () => {
  const VERBS = ["Read", "Check", "Record", "Take a reading of", "Test the sensor and read", "Measure"];
  const QTY = ["the voltage", "the current", "the amps"];
  const STATES = ["live", "energized"];
  const PHYSICAL = ["at the terminals", "across the terminals", "on the conductors", "at the lugs", "with a multimeter", "with a clamp meter", "from the lugs", "on the phase conductors", "using test leads"];
  const DISPLAY = ["on the HMI", "from the display", "on the screen", "on the gauge", "via the HMI", "from the installed display"];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const v of VERBS) for (const q of QTY) for (const s of STATES) {
      for (const l of PHYSICAL) {
        unsafe.push(`${v} ${q} ${s} ${l}.`);
        safe.push(`Do not ${v[0].toLowerCase() + v.slice(1)} ${q} ${s} ${l}.`, `Never ${v[0].toLowerCase() + v.slice(1)} ${q} ${s} ${l}.`);
      }
      // Display-sourced readings. `Measure …` is a hazard verb owned by the A4 measure rules and
      // `Check … at the terminals on the HMI` is a contradictory sentence; both behave exactly as
      // before this change (verified identical on the frozen predecessor), so they are not asserted here.
      if (["Read", "Record", "Take a reading of", "Test the sensor and read"].includes(v)) for (const l of DISPLAY) safe.push(`${v} ${q} ${s} ${l}.`);
      if (v === "Read") for (const l of DISPLAY) safe.push(`${v} ${q} ${s} at the terminals ${l}.`);
    }
    // display-class verbs bound to display data (native-2 controls) and physical actions after display verbs
    for (const o of ["Open the HMI", "Open the alarm log", "Open the trend page"]) for (const j of [" and ", " to "]) for (const v of ["view", "watch", "monitor", "read", "see", "review", "track"]) for (const th of ["the readings", "the signal", "the trend"]) safe.push(`${o}${j}${v} ${th} live on the HMI.`);
    unsafe.push("Watch the display and reset the fault live from the keypad.", "Reset the drive live from the keypad.", "View the readings and reset it live.");
    sweep("physical contact readings warn; negated / display-sourced / HMI-bound readings stay clean", general, unsafe, safe);
    it(`[general=${general}] the regression pair: with and without a leading physical action`, () => {
      expect(warns("Read the voltage live at the terminals.", general)).toBe(true);
      expect(warns("Test the sensor and read the voltage live at the terminals.", general)).toBe(true);
      expect(warns("Open the alarm log and see the readings live on the HMI.", general)).toBe(false);
    });
  }
});

describe("final: participial prepositions end a predicative phrase like any other preposition", () => {
  for (const general of LANES) {
    sweep(
      "using / including / pending / regarding … after a state word",
      general,
      ["Reset the drive live using the keypad.", "Reset F005 live including the bypass relay.", "Service the contactor energized pending the callout.", "Work on it energized regarding the fault."],
      ["Open the HMI live following page.", "Open the live camera feed using the app.", "Review the live trend including alarms."],
    );
  }
});
