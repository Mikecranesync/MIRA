/**
 * #5962 / PR #6015 native review round 2 (F1, F2, F3, F4, F5, F7) through the
 * real exported validateAnswer in both lanes. Class-level cases: connective
 * classes x prohibited-act classes x hazard-action classes, with unsafe/safe
 * pairs, reversed negation, unsafe siblings and warning-prefix assertions
 * (what the technician READS), never only "a warning exists".
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-native2-5962
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/capabilities/answer-validation";

const LANES = [false, true] as const;
const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";
const cap = (v: string) => v[0].toUpperCase() + v.slice(1);

function judge(answerText: string, general: boolean) {
  return validateAnswer({ answerText, question: Q, general, served: true, refused: false, evidenceSufficient: true });
}
function hazard(text: string, general: boolean): boolean {
  const r = judge(text, general);
  return !r.ok && r.kind === "hazard_warning" && /clause-hazard/.test(r.violation);
}
/** The warning line(s) above the intact answer. */
function prefixOf(text: string, general: boolean): string {
  const r = judge(text, general);
  if (r.ok || r.kind !== "hazard_warning") throw new Error(`no hazard_warning for: ${text}`);
  expect(r.replacement.endsWith(text)).toBe(true);
  return r.replacement.slice(0, r.replacement.length - text.length);
}
function sweep(name: string, general: boolean, unsafe: readonly string[], safe: readonly string[]) {
  it(`[general=${general}] ${name}`, () => {
    const missed = unsafe.filter((t) => !hazard(t, general));
    const falseWarn = safe.filter((t) => hazard(t, general));
    expect({ missed, falseWarn }).toEqual({ missed: [], falseWarn: [] });
  });
}

const GUARD_VERBS = ["bypass", "jumper", "defeat", "disable", "override"];
const GUARD_OBJECTS = ["the guard", "the interlock", "the E-stop", "the light curtain"];
const ENERGY_ACTIONS = ["reset the drive", "clear the fault", "work on it", "service the contactor", "open the panel", "replace the fuse"];
const ENERGY_STATES = ["while energized", "while it is live", "with the power on", "live", "energized"];

// ------------------------------------------------------------------ F1
describe("native2 F1: a prohibition governs its own action, not a separate sequenced/alternative one", () => {
  const SEQ = [" and then ", " or else ", ", or else ", ", and then ", " then ", " otherwise ", ", otherwise ", " afterwards ", " and afterwards "];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safeOwnNegation: string[] = [];
    const safeShared: string[] = [];
    for (const n of ["Never ", "Do not "]) for (const v of GUARD_VERBS) for (const o of GUARD_OBJECTS) for (const a of ENERGY_ACTIONS) for (const s of ENERGY_STATES) {
      for (const c of SEQ) unsafe.push(`${n}${v} ${o}${c}${a} ${s}.`);
      safeOwnNegation.push(`${n}${v} ${o} and then do not ${a} ${s}.`);
      safeShared.push(`${n}${v} ${o} or ${a} ${s}.`);
    }
    sweep("sequence / alternative connective after a guard prohibition: the energized action warns", general, unsafe, [...safeOwnNegation, ...safeShared]);
    it(`[general=${general}] the quoted step is the RESET, not the prohibited bypass`, () => {
      for (const t of ["Never bypass the guard and then reset the drive while energized.", "Do not bypass the interlock, or else reset the drive while energized."]) {
        const p = prefixOf(t, general);
        expect(p).toContain("reset the drive while energized");
        expect(p).not.toMatch(/“[^”]*(?:Never|Do not) bypass/);
      }
    });
    it(`[general=${general}] related shapes: prohibition elsewhere never clears a later sequenced hazard`, () => {
      const unsafe2 = [
        "Never open the cover and afterwards work on it energized.",
        "Do not touch the heatsink; otherwise reset the fault live.",
        "Never reset it live, and then work on it energized.",
        "Do not remove the guard or else service the contactor with the power on.",
      ];
      expect(unsafe2.filter((t) => !hazard(t, general))).toEqual([]);
    });
  }
});

// ------------------------------------------------------------------ F2
describe("native2 F2: numeric citation markers are transparent to detection only", () => {
  const CITES = ["", " [1]", " [1][2]", " [1, 2]", " [1-3]"];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const a of ["reset F005", "reset the fault", "work on the drive", "service breaker CB-7", "replace the fuse", "reset it"]) for (const s of ["live", "energized"]) for (const c of CITES) {
      unsafe.push(`${cap(a)} ${s}${c}.`, `${cap(a)} ${s}.${c}`, `Please ${a}${c} ${s}.`);
      safe.push(`Do not ${a} ${s}${c}.`, `Never ${a} ${s}${c}.`);
    }
    // citations between the action and the object, and between the object and the state
    for (const c of [" [1]", " [1][2]"]) {
      unsafe.push(`Reset${c} F005 live.`, `Reset F005${c} live.`, `Clear the fault${c} energized now.`);
      safe.push(`Do not reset${c} F005 live.`, `Never reset F005${c} live.`);
    }
    sweep("unsafe order warns with 0/1/2 markers wherever the marker sits; prohibitions stay clean", general, unsafe, safe);
    sweep("descriptive compounds with a marker stay clean", general, [], [
      "Open the HMI live [1] telemetry view.", "The live bus voltage trend [1].", "Open the live trend page [1][2].", "Review the live waveform on the HMI [1].",
    ]);
  }
  it("the marker class is numeric citations only: other bracketed text stays opaque (pinned, UNCHANGED from before; a known limit, not an endorsement)", () => {
    for (const general of LANES) {
      expect(hazard("Reset F005 live [note].", general)).toBe(false);
      expect(hazard("Reset F005 live [see manual].", general)).toBe(false);
      expect(hazard("Reset F005 live [12345].", general)).toBe(false); // not a citation-shaped marker
    }
  });
});

// ------------------------------------------------------------------ F3
describe("native2 F3: an ongoing guard-defeat REPORT is a condition, not a directive", () => {
  const SUBJECTS = ["anyone", "an operator", "operators", "someone", "a technician", "you"];
  const AUX = ["is", "are", "keeps", "continues to"];
  const GERUNDS = ["bypassing", "jumpering", "disabling", "overriding"];
  const PROTECTIVE = ["stop the line", "call the supervisor", "evacuate the area", "lock out the machine"];
  const UNSAFE_CONSEQUENTS = ["bypass the E-stop", "jumper the guard", "reset the drive live", "work on it energized"];
  for (const general of LANES) {
    const safe: string[] = [];
    const unsafe: string[] = [];
    for (const w of ["If", "When", "Whenever", "While"]) for (const sub of SUBJECTS) for (const aux of AUX) for (const g of GERUNDS) for (const o of GUARD_OBJECTS) for (const cons of PROTECTIVE) {
      safe.push(`${cap(cons)} ${w.toLowerCase()} ${sub} ${aux} ${g} ${o}.`, `${w} ${sub} ${aux} ${g} ${o}, ${cons}.`);
    }
    for (const w of ["If", "When"]) for (const sub of ["anyone", "operators"]) for (const g of ["bypassing", "jumpering"]) for (const o of GUARD_OBJECTS) for (const bad of UNSAFE_CONSEQUENTS) {
      unsafe.push(`${w} ${sub} is ${g} ${o}, ${bad}.`, `${w} ${sub} is ${g} ${o}, stop the line, then ${bad}.`);
    }
    unsafe.push("If stuck you should be bypassing the interlock.", "While the drive is running, reset the fault.");
    sweep("protective consequent stays clean in both orders; an unsafe consequent still warns", general, unsafe, safe);
    it(`[general=${general}] an unsafe sibling is never pardoned by the protective clause`, () => {
      const t = "Stop the line if anyone is bypassing the interlock, and you should bypass the guard.";
      expect(hazard(t, general)).toBe(true);
      expect(prefixOf(t, general)).toContain("bypass the guard");
    });
  }
});

// ------------------------------------------------------------------ F7
describe("native2 F7: a report mask ends at the temporal connective that opens a separate action", () => {
  const REPORTS = ["Warn against bypassing the interlock", "Prevent operators from bypassing the interlock", "Stop anyone from bypassing the guard", "Guard against jumpering the E-stop"];
  const TEMPORAL = ["before", "after", "until", "once"];
  const SUBJ = ["you reset the drive", "resetting the drive", "we work on it", "operators service the contactor"];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const r of REPORTS) {
      safe.push(`${r}.`);
      for (const t of TEMPORAL) for (const b of SUBJ) {
        for (const s of ["while energized", "while it is live", "live", "energized"]) unsafe.push(`${r} ${t} ${b} ${s}.`);
        safe.push(`${r} ${t} ${b}.`); // no energy relation
      }
      safe.push(`${r} and never reset the drive while energized.`);
    }
    sweep("the separate temporal predicate warns; standalone / no-energy / own-negation stay clean", general, unsafe, safe);
    it(`[general=${general}] the quoted step is the later reset`, () => {
      const p = prefixOf("Warn against bypassing the interlock before you reset the drive while energized.", general);
      expect(p).toContain("reset the drive while energized");
    });
  }
});

// ------------------------------------------------------------------ F4
describe("native2 F4: the state binds to the nearest verb; display verbs are not energized work", () => {
  const DISPLAY_OPEN = ["Open the HMI", "Open the alarm log", "Open the trend page", "Open the dashboard", "Open the panel view"];
  const DISPLAY_VERBS = ["view", "watch", "monitor", "read", "see", "review", "track"];
  const THINGS = ["the readings", "the signal", "it", "the trend"];
  const PHYS_OPEN = ["Open the panel", "Reset the drive", "Service the contactor"];
  const PHYS_VERBS = ["reset", "test", "service", "adjust", "replace"];
  const PHYS_THINGS = ["the drive", "it", "the fault", "breaker 7"];
  for (const general of LANES) {
    const safe: string[] = [];
    const unsafe: string[] = [];
    for (const o of DISPLAY_OPEN) for (const j of [" and ", " to ", " then "]) for (const v of DISPLAY_VERBS) for (const th of THINGS) for (const tail of [" live", " live on the HMI", " live now"]) safe.push(`${o}${j}${v} ${th}${tail}.`);
    for (const o of PHYS_OPEN) for (const j of [" and ", " to "]) for (const v of PHYS_VERBS) for (const th of PHYS_THINGS) for (const tail of [" live", " energized", " live from the keypad"]) unsafe.push(`${o}${j}${v} ${th}${tail}.`);
    unsafe.push("Reset the drive live from the keypad.", "Watch the display and reset the fault live from the keypad.", "View the readings and reset it live.");
    safe.push("Open the alarm log and view the readings live on the HMI.", "Open the HMI to view the readings live.", "Open the trend page and watch it live.", "Test the sensor and view the signal live on the HMI.");
    sweep("display actions stay clean; physical actions bound to the state still warn", general, unsafe, safe);
  }
});

// ------------------------------------------------------------------ F5
describe("native2 F5: the warning prefix quotes the match that ESTABLISHES the hazard", () => {
  const HARMLESS_NOUNS = ["test record", "service history", "maintenance log", "repair order", "open items list", "adjustment sheet", "replacement schedule"];
  const long = (noun: string, tail: string) =>
    `Use the ${noun} from the previous inspection with the extended equipment checklist and the documented maintenance handover details along with the companion checklist before the current service operation to ${tail}`;
  for (const general of LANES) {
    it(`[general=${general}] a verb-looking noun earlier in a >160-char sentence does not pull the excerpt away`, () => {
      for (const noun of HARMLESS_NOUNS) {
        for (const tail of ["reset the fault live.", "clear the fault energized.", "work on it while energized.", "service the contactor with the power on."]) {
          const t = long(noun, tail);
          expect(t.indexOf("to " + tail)).toBeGreaterThan(160);
          const p = prefixOf(t, general);
          expect(p).toContain(tail.replace(/\.$/, ""));
          expect(p).not.toMatch(/“[^”]*companion ch”/);
        }
      }
    });
    it(`[general=${general}] a guard-defeat match after harmless text is the quoted step`, () => {
      const t = long("test record", "bypass the guard interlock.");
      expect(prefixOf(t, general)).toContain("bypass the guard interlock");
    });
    it(`[general=${general}] the full answer stays intact underneath, including a fronted energy condition`, () => {
      const t = "Start with the cover. While the drive is energized, reset the fault.";
      const p = prefixOf(t, general);
      expect(p).toContain("While the drive is energized");
      expect(p).toContain("reset the fault");
    });
  }
});
