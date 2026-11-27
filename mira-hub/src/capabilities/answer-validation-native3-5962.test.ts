/**
 * #5962 / PR #6015 native review round 3 (F1, F3, F4, F7, F5, F9) through the real
 * exported validateAnswer in both lanes. Class-level, generated pairwise grids with
 * the controls that matter (shared negation, own negation, reported/contrast,
 * modifiers of the reported act, display source) and warning-PREFIX assertions
 * (what the technician reads), never only "a warning exists".
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-native3-5962
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
  if (r.ok || r.kind !== "hazard_warning") throw new Error(`no hazard_warning for: ${JSON.stringify(text)}`);
  expect(r.replacement.endsWith(text)).toBe(true); // the original answer is never altered
  return r.replacement.slice(0, r.replacement.length - text.length);
}
function sweep(name: string, general: boolean, unsafe: readonly string[], safe: readonly string[]) {
  it(`[general=${general}] ${name}`, () => {
    const missed = unsafe.filter((t) => !warns(t, general));
    const falseWarn = safe.filter((t) => warns(t, general));
    expect({ missed, falseWarn }).toEqual({ missed: [], falseWarn: [] });
  });
}

const GUARD_VERBS = ["bypass", "jumper", "disable"];
const GUARD_OBJECTS = ["the guard", "the interlock", "the E-stop"];
const ENERGY_ACTIONS = ["reset the drive", "clear the fault", "work on it"];
const ENERGY_STATES = ["while energized", "with the power on", "live"];

// ------------------------------------------------------------------ F1
describe("native3 F1: a prohibition governs its own predicate; a distinct causal/sequenced imperative is its own", () => {
  // adjunct = a preposition phrase or a sequencing/causal adverb between the coordinator and the verb
  const ADJUNCTS = [
    "so instead", "and in the next step", "or later on", "and at that point", "so first", "and after lunch",
    "or afterwards", "and during the shift", "or in a second pass", "and at the bench", "so then instead", "nor in the meantime",
  ];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const ownNegation: string[] = [];
    const sharedBare: string[] = [];
    for (const n of ["Never ", "Do not "]) for (const v of GUARD_VERBS) for (const o of GUARD_OBJECTS) for (const a of ENERGY_ACTIONS) for (const s of ENERGY_STATES) {
      for (const j of ADJUNCTS) {
        unsafe.push(`${n}${v} ${o} ${j} ${a} ${s}.`);
        ownNegation.push(`${n}${v} ${o} ${j} do not ${a} ${s}.`);
      }
      sharedBare.push(`${n}${v} ${o} or ${a} ${s}.`, `${n}${v} ${o} and ${a} ${s}.`);
    }
    // the prohibited act is not the guard: same structure
    for (const j of ["so instead", "and in the next step", "or later on"]) for (const a of ENERGY_ACTIONS) for (const s of ENERGY_STATES) unsafe.push(`Never open the cover ${j} ${a} ${s}.`);
    sweep("causal/sequenced adjunct before a new imperative warns; own negation and bare shared coordination stay clean", general, unsafe, [...ownNegation, ...sharedBare]);
    it(`[general=${general}] the warning quotes the RESET, not the prohibited bypass`, () => {
      for (const t of ["Do not bypass the guard so instead reset the drive while energized.", "Never bypass the guard and in the next step reset the drive while energized."]) {
        const p = prefixOf(t, general);
        expect(p).toContain("reset the drive while energized");
        expect(p).not.toMatch(/“[^”]*(?:Never|Do not) bypass/);
      }
    });
  }
});

// ------------------------------------------------------------------ F3
describe("native3 F3: EVERY reported condition is a report; a hazardous consequent is the quoted step", () => {
  const WHO = ["anyone", "someone", "an operator", "operators"];
  const GER = ["bypassing", "jumpering", "disabling", "overriding"];
  const PROTECTIVE = ["stop the line", "call the supervisor", "evacuate the area"];
  const UNSAFE = ["bypass the E-stop", "reset the drive live", "work on it energized"];
  for (const general of LANES) {
    const safe: string[] = [];
    const unsafe: string[] = [];
    for (const w of ["If", "When"]) for (const a of WHO) for (const g1 of GER) for (const o1 of GUARD_OBJECTS) for (const sep of [" or if ", " and if ", " or when ", " or "]) for (const b of WHO.slice(0, 3)) for (const g2 of GER.slice(0, 2)) for (const o2 of GUARD_OBJECTS.slice(0, 2)) {
      const reports = `${w} ${a} is ${g1} ${o1}${sep}${b} is ${g2} ${o2}`;
      for (const c of PROTECTIVE.slice(0, 2)) safe.push(`${reports}, ${c}.`, `${cap(c)} ${reports.replace(/^(If|When)/, (m) => m.toLowerCase())}.`);
    }
    // three coordinated reports
    safe.push("Stop the line if anyone is bypassing the interlock or if someone is disabling the guard or if operators are jumpering the E-stop.");
    for (const w of ["If", "When"]) for (const a of WHO.slice(0, 2)) for (const g1 of GER.slice(0, 2)) for (const sep of [" or if ", " and if "]) for (const u of UNSAFE) unsafe.push(`${w} ${a} is ${g1} the interlock${sep}someone is disabling the guard, ${u}.`);
    sweep("two/three coordinated reports + protective consequent stay clean in both orders; an unsafe consequent still warns", general, unsafe, safe);
    it(`[general=${general}] the warning quotes the consequent and excludes both reports`, () => {
      const t = "If anyone is bypassing the interlock or if someone is disabling the guard, bypass the E-stop.";
      const p = prefixOf(t, general);
      expect(p).toContain("bypass the E-stop");
      expect(p).not.toMatch(/“[^”]*(?:bypassing the interlock|disabling the guard)/);
    });
    it(`[general=${general}] an independent directive after a report is still judged`, () => {
      expect(warns("Stop the line if anyone is bypassing the interlock or if someone is disabling the guard, and you should bypass the E-stop.", general)).toBe(true);
    });
  }
});

// ------------------------------------------------------------------ F4
describe("native3 F4: contact and display-source belong to the measurement they modify", () => {
  const VERBS = ["Read", "Check"];
  const QTY = ["the voltage", "the current"];
  const STATES = ["live", "energized"];
  const CONTACT = ["at the terminals", "across the terminals", "with a multimeter", "on the conductors"];
  const COMPARE = [" to compare it to the value on the HMI", " and compare it with the HMI value", " to confirm it against the display", " versus the value on the screen", " to check it against the gauge"];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const v of VERBS) for (const q of QTY) for (const s of STATES) for (const l of CONTACT) for (const c of COMPARE) {
      unsafe.push(`${v} ${q} ${s} ${l}${c}.`, `Test the sensor and ${v.toLowerCase()} ${q} ${s} ${l}${c}.`);
    }
    // the reading ITSELF is taken from the display; only the comparison value is at the terminals
    for (const q of QTY) for (const s of STATES) for (const src of ["from the HMI", "on the HMI", "from the display", "on the screen"]) for (const c of [" to compare it with the previous terminal measurement", " versus the earlier terminal value", " and compare it to the last reading at the terminals"]) {
      safe.push(`Read ${q} ${s} ${src}${c}.`);
    }
    // controls from earlier rounds
    safe.push("Open the alarm log and see the readings live on the HMI.", "Do not read the voltage live at the terminals.", "Read the voltage live on the HMI.");
    unsafe.push("Read the voltage live at the terminals.", "Test the sensor and read the voltage live at the terminals.");
    sweep("a terminal reading compared with a display value warns; a display reading compared with a terminal value stays clean", general, unsafe, safe);
  }
});

// ------------------------------------------------------------------ F7
describe("native3 F7: a reader-directed temporal predicate ends the report; a modifier of the reported act stays inside it", () => {
  const REPORTS = ["Warn against bypassing the interlock", "Prevent operators from bypassing the interlock", "Stop anyone from bypassing the guard", "Guard against jumpering the E-stop"];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const r of REPORTS) {
      for (const t of ["while", "when", "as", "whenever"]) {
        for (const b of ["you reset the drive", "you clear the fault", "we work on it", "operators service the contactor", "resetting the drive"]) for (const s of ["while energized", "while it is live", "live", "energized"]) unsafe.push(`${r} ${t} ${b} ${s}.`);
        for (const b of ["the machine is energized", "the drive is live", "it runs"]) safe.push(`${r} ${t} ${b}.`);
        safe.push(`${r} ${t} you do not reset the drive while energized.`);
      }
      safe.push(`${r}.`);
    }
    sweep("while/when/as + a separate action warns; modifiers of the reported act, own-negated continuations and the standalone report stay clean", general, unsafe, safe);
    it(`[general=${general}] the quoted step is the later reset`, () => {
      for (const t of ["Warn against bypassing the interlock while you reset the drive while energized.", "Warn against bypassing the interlock as you reset the drive while energized."]) {
        expect(prefixOf(t, general)).toContain("reset the drive while energized");
      }
    });
  }
});

// ------------------------------------------------------------------ F5
describe("native3 F5: the excerpt window and its anchor share one coordinate system, whatever the whitespace", () => {
  const LEADS = [
    "Use the test record from the last inspection and the attached maintenance checklist in this document",
    "Open the service history and compare the replacement schedule against the documented handover details",
  ];
  // The tail stays in the SAME sentence, is long enough that the max-window clamp cannot retain the action
  // by accident, and contains NO clause separator ("and then", "or else", ...), which would shorten the
  // excerpt clause and hide the offset error. (A first version of this test used "and then" and did not
  // reproduce the defect on the reviewed head; it was rebuilt on the reproducing structure.)
  const TAIL =
    " and record the result in the maintenance log with the measured values for the next shift to inspect and record the inspection date and current counter in the shift handover worksheet and notify the supervisor after the documentation is complete.";
  const ACTIONS = ["reset the drive while energized", "clear the fault while it is live", "work on it with the power on"];
  // single spacing and single tabs are coordinate CONTROLS; repeated spaces / mixed runs shift raw offsets
  const SPACERS = [" ", "\t", "    ", "     ", "      ", "  \t  ", "\t\t\t\t\t", "        "];
  for (const general of LANES) {
    it(`[general=${general}] the warning quotes the complete action for single/repeated spaces and tabs; the answer is untouched`, () => {
      const wrong: string[] = [];
      let longEnough = 0;
      for (const L of LEADS) for (const a of ACTIONS) for (const sp of SPACERS) {
        const text = `${L.split(" ").join(sp)} ${a}${TAIL}`;
        expect(text.length - text.indexOf(a)).toBeGreaterThan(200);
        if (text.replace(/\s+/g, " ").length > 320) longEnough++;
        const p = prefixOf(text, general);
        if (!p.includes(a)) wrong.push(`${JSON.stringify(sp)} :: ${a}`);
      }
      expect(longEnough).toBeGreaterThan(0);
      expect(wrong).toEqual([]);
    });
    it(`[general=${general}] the fronted energy condition stays with the action under repeated whitespace`, () => {
      const text = `${LEADS[0].split(" ").join("     ")}      while   the   drive   is   energized   reset   the   fault${TAIL}`;
      const p = prefixOf(text, general);
      expect(p).toContain("reset the fault");
    });
  }
});

// ------------------------------------------------------------------ F9
describe("native3 F9: removing a citation token never joins separate lines or paragraphs", () => {
  const SEPS = ["\n\n", "\n", "\n \n", "\n\n\n"];
  const CITED: ReadonlyArray<readonly [string, string]> = [["[1] ", "[2]"], ["", "[1][2]"], ["[1][2] ", ""], ["[1, 2] ", "[3]"], ["\t[1] ", ""]];
  for (const general of LANES) {
    const unsafe: string[] = [];
    const safe: string[] = [];
    for (const sep of SEPS) for (const a of ["Reset the drive while energized", "Clear the fault live", "Work on it energized"]) for (const [pre, post] of CITED) {
      const tail = post ? ` ${post}` : "";
      unsafe.push(`Never reset the drive${sep}${pre}${a}${tail}.`, `Do not touch the heatsink${sep}${pre}${a}${tail}.`);
      safe.push(`Never reset the drive${sep}${pre}Do not ${a[0].toLowerCase()}${a.slice(1)}${tail}.`);
    }
    // inline transparency is kept (earlier-round controls)
    unsafe.push("Reset F005 live [1].", "Reset F005 live [1][2].", "Reset [1] F005 live.");
    safe.push("Do not reset F005 live [1].", "Open the HMI live [1] telemetry view.");
    sweep("a paragraph boundary survives the token; inline citations stay transparent", general, unsafe, safe);
  }
});
