/**
 * #4122 — the step-energy checker. Real fixtures: the two staging 9e4bf1f2
 * isolation answers a technician marked unsafe in the #4101 review (ask 1 and
 * ask 3 of "After isolation and verifying absence of voltage, what should I check
 * next?"). Controls: correct sequences and dead checks must never flag.
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "./answer-validation";
import { stepEnergyContradiction } from "./step-energy";

const ASK1 = "The first thing to look at after you’ve locked out, tagged out and confirmed the circuit is dead is the **input power fuse or circuit breaker** – a blown fuse or tripped breaker is the most common cause of a dead‑line condition.\n\n**Next checks (de‑energized):**  \n1. With the lockout still in place, inspect the main fuse or breaker for visible signs of failure or a tripped position.  \n2. Verify the fuse continuity with a low‑voltage ohmmeter (meter proven on a known source) or replace it with a known good spare.  \n3. If the breaker is reset, make sure the handle stays in the “on” position; if it trips again, note any overload or short‑circuit signs.  \n4. Look at the incoming power terminals for loose or corroded connections; tighten only after the lockout is removed and power is restored by a qualified person.  \n\n**If the fuse/breaker is fine**, the next likely area is the **input contactor/coils** – check for burned contacts or a failed coil (again de‑energized, then test coil resistance after lockout removal).  \n\n*Do you know whether the equipment is showing any fault codes or alarms, or is it simply not powering up?*";
const ASK3 = "The first thing to look at after you’ve locked out, tagged out and confirmed the circuit is dead is the **power‑entry components** (fuses, circuit breaker, contactor coil and any input fuses or surge protectors).  \n\n1. With the lockout in place, visually inspect the input fuses/ breakers for blown elements or tripped positions.  \n2. If a breaker is tripped, reset it and watch for immediate re‑trip; if a fuse is blown, replace it with the correct rating (verify against the nameplate).  \n3. Check the contactor coil resistance with an ohmmeter (still de‑energized) – an open or very high reading can indicate a coil failure.  \n4. Look for any obvious burnt contacts, melted insulation, or loose wiring at the power entry terminals.  \n\nIf those items are all good, let me know what symptom you’re seeing (no start, fault code, abnormal noise, etc.) so I can suggest the next diagnostic focus.";

describe("#4122 stepEnergyContradiction — the flagged staging answers", () => {
  it("ask 1: a breaker reset inside the de-energized checks is flagged", () => {
    expect(stepEnergyContradiction(ASK1)).toMatch(/breaker is reset/);
  });
  it("ask 3: 'reset it and watch for re-trip' under an opening lockout is flagged", () => {
    expect(stepEnergyContradiction(ASK3)).toMatch(/reset it and watch for immediate re-trip/);
  });
  it("the technician-flagged shape: tightening scheduled for after power is restored", () => {
    const t = "4. Look at the incoming terminals for loose connections; tighten only after the lockout is removed and power is restored by a qualified person.";
    expect(stepEnergyContradiction(t)).toMatch(/tighten only after/);
  });
  it("a live reading inside a locked-out clause is flagged", () => {
    expect(stepEnergyContradiction("With the machine locked out and the coil terminals isolated, measure the coil voltage with a multimeter.")).not.toBeNull();
  });
});

describe("#4122 stepEnergyContradiction — controls that must never flag", () => {
  it.each([
    ["dead checks", "1. Lock out the drive.\n2. Verify absence of voltage with a meter proven on a known source.\n3. Check coil resistance and fuse continuity."],
    ["correct sequence", "1. With the machine locked out, inspect the terminals and tighten any loose ones.\n2. After a qualified person removes the lockout and restores power under the site's energized-work procedure, measure the supply voltage."],
    ["verify de-energized", "Isolate the panel: lockout/tagout the power source and verify that the circuit is de-energized with a voltage tester."],
    ["low-voltage adjective", "With the lockout in place, verify fuse continuity with a low-voltage ohmmeter."],
    ["teaching answer", "A VFD controls motor speed by changing the output frequency; the rectifier makes a DC bus and IGBTs rebuild a variable-frequency AC waveform."],
  ])("%s", (_name, text) => {
    expect(stepEnergyContradiction(text)).toBeNull();
  });
});

describe("#4122 validateAnswer — banner above the full answer, never withheld", () => {
  it("ask 3 gets a hazard_warning that quotes the step and keeps every word of the answer", () => {
    const v = validateAnswer({ answerText: ASK3, question: "After isolation and verifying absence of voltage, what should I check next?", general: true, served: true, refused: false, evidenceSufficient: false });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("hazard_warning");
    expect(v.violation).toBe("hazard-warning:step-energy-contradiction");
    expect(v.replacement).toContain("Lockout conflict in a step below");
    expect(v.replacement.endsWith(ASK3)).toBe(true);
  });
  it("control: a correct locked-out checklist passes", () => {
    const v = validateAnswer({ answerText: "1. With the drive locked out, check the input fuses for continuity.\n2. Inspect the terminals for loose or burnt wiring.", question: "What should I check next?", general: true, served: true, refused: false, evidenceSufficient: false });
    expect(v.ok).toBe(true);
  });
});

// Known limitation (documented on #4146): a LATER restore step with the lockout never
// written as removed ("Now restore power. Press Run", "Apply main voltage again and
// measure") is read as the transition out of isolation. Flagging it cost precision on
// the labeled set (correct answers often say "once power is restored"), so it is not.
describe("#4146 review r1 — paraphrases the safety lens found (must flag)", () => {
  it.each([
    ["jog under lockout", "Place the selector in the LOCKOUT position. Jog the motor by pressing start and listen for smooth rotation."],
    ["energize the circuit while locked out", "With the circuit locked out, energize the control circuit and watch the contactor pull in."],
  ])("%s", (_name, text) => {
    expect(stepEnergyContradiction(text)).not.toBeNull();
  });
});

describe("#4146 review r1 — safe answers the false-positive lens found (must not flag)", () => {
  it.each([
    ["display noted before isolating", "Before you isolate the drive, check what the display is showing. After you've noted the display state and any fault codes, proceed to lock out and tag out the power source."],
    ["LEDs noted before isolating", "Observe the indicator LEDs on the front. Once you've noted the LED pattern, then proceed with lockout/tagout procedures."],
    ["fuse replacement under lockout", "With the drive locked out, check the input fuse for continuity.\nIf the fuse is blown, replace it with an identical rating and verify from the nameplate that you have the right amperage and voltage class."],
    ["correct later restore by a qualified person", "1. Lock out the drive and verify absence of voltage.\n2. Inspect and tighten the terminals.\n3. A qualified person then removes the lockout and restores power under the site's energized-work procedure, and you jog the motor to confirm rotation."],
  ])("%s", (_name, text) => {
    expect(stepEnergyContradiction(text)).toBeNull();
  });
});

describe("#4146 Codex r1", () => {
  it("F1: a restore instructed while the lockout is stated in the same step is flagged", () => {
    expect(stepEnergyContradiction("With the machine locked out, reconnect power and press the start button.")).not.toBeNull();
  });
  it.each([
    ["do not press start", "With the lockout in place, do not press the start button."],
    ["never measure", "With the machine locked out, never measure the output voltage."],
  ])("F2: a prohibition is not an instruction (%s)", (_n, text) => {
    expect(stepEnergyContradiction(text)).toBeNull();
  });
  it("F3: isolation carries to the next sentence of the same list item", () => {
    expect(stepEnergyContradiction("1. With the drive locked out, inspect the wiring. Measure the output voltage.")).not.toBeNull();
  });
});

describe("#4146 Codex r2", () => {
  it.each([
    ["F1: a continuing lockout is not ended by 'then'", "With the lockout still in place, reconnect power and then press the start button."],
    ["F2: an instruction after 'but' survives the prohibition", "With the machine locked out, do not touch the wiring but press the start button."],
    ["F2: 'do not forget to' is an instruction, not a prohibition", "With the machine locked out, do not forget to press the start button."],
  ])("%s", (_n, text) => {
    expect(stepEnergyContradiction(text)).not.toBeNull();
  });
  it("F3: a prohibition of mechanical work after restore is correct advice, not a flag", () => {
    expect(stepEnergyContradiction("Do not tighten the terminals after power is restored.")).toBeNull();
  });
  it("control: an isolated measurement then a written restore stays unflagged", () => {
    expect(stepEnergyContradiction("With the circuit isolated and locked out, measure resistance across the terminals, then restore power.")).toBeNull();
  });
});

describe("#4146 Codex r3 — the two confirmed defects (via validateAnswer, as the route calls it)", () => {
  const check = (answerText: string) =>
    validateAnswer({ answerText, question: "What should I check next?", general: true, served: true, refused: false, evidenceSufficient: false });

  it("F2: bold formatting does not hide a lockout conflict", () => {
    const v = check("With the machine **locked out**, press the **start** button.");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.violation).toBe("hazard-warning:step-energy-contradiction");
  });
  it("F2: curly and straight apostrophes give the same result", () => {
    const curly = check("With the lockout in place, don\u2019t press the start button.");
    const straight = check("With the lockout in place, don't press the start button.");
    expect(curly.ok).toBe(straight.ok);
    expect(curly.ok).toBe(true);
  });
  it("F4: measuring to confirm absence of voltage is correct advice, not a flag", () => {
    expect(check("With the machine locked out, measure the output voltage to confirm absence of voltage.").ok).toBe(true);
  });
  it("control: a live reading under lockout is still flagged, and the banner keeps the full answer", () => {
    const answer = "With the machine locked out, measure the output voltage while the drive runs.";
    const v = check(answer);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.kind).toBe("hazard_warning");
      expect(v.replacement.endsWith(answer)).toBe(true);
    }
  });
});

