/**
 * #4858 — a grounded answer that directs hands-on electrical or mechanical
 * work, and that lacks isolation or verify-dead language, must get a fixed
 * uncited notice prepended: disconnect power per the manual, lock out per
 * site procedure, verify absence of voltage. Parameter-only answers must
 * not. The notice warns and never withholds the answer.
 *
 * Style twin of answer-validation-energized-procedure.test.ts: the cases
 * go through validateAnswer, the same pre-display gate route.ts already
 * prepends (~4324–4337).
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-isolation-advisory
 */
import { describe, expect, it } from "vitest";
import { validateAnswer } from "@/capabilities/answer-validation";

const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";

function judge(answerText: string) {
  return validateAnswer({
    answerText,
    question: Q,
    general: false,
    served: true,
    refused: false,
    evidenceSufficient: true,
  });
}

/** Hands-on electrical / mechanical work. Each must get the isolation notice. */
const HANDS_ON: readonly string[] = [
  // The #4858 D4 staging shape (v3.419.28 / 92e892a48): install is hands-on
  // DC-bus work sitting next to a parameter option.
  "Bus overvoltage can also be caused by motor regeneration, so extend the decel time or install the dynamic brake option [1].",
  "Replace the input fuse.",
  "Replace the main contactor.",
  "Open the drive cover and inspect the DC bus capacitors [1].",
  "Rewire the motor terminals.",
  "Swap the cooling fan.",
  "Tighten the incoming lugs.",
  "Pull the RFI jumper.",
  "Install a new control card.",
  "Remove the cover and clean the filter.",
  "Connect the brake resistor wires on the DC bus [1].",
  "Replace the worn belt.",
];

/** Parameter-only / diagnostic answers. Each must stay silent. */
const PARAMETER_ONLY: readonly string[] = [
  "Extend the decel time.",
  "Increase the accel time to reduce regeneration.",
  "Set P039 to 10 seconds.",
  "Reduce the slip compensation.",
  "Raise the overvoltage threshold.",
  "Lower the carrier frequency.",
  "Enable flying start.",
  "Program A555 to 2.",
  // The D4 twin without the install clause — parameter-only, even though it
  // names the bus.
  "Bus overvoltage can also be caused by motor regeneration, so extend the decel time [1].",
  "Change P043 from 5 to 15.",
  "Adjust the current limit.",
  "The fault means DC bus overvoltage — increase decel time [1].",
];

const DISCONNECT = /disconnect power per the manual/i;
const LOCKOUT = /lock out per site procedure/i;
const VERIFY_DEAD = /absence of voltage/i;
const DISCHARGE_WAIT = /follow the manual's discharge wait/i;
const INVENTED_MINUTES = /\b\d+\s*(?:min|minutes?|seconds?|hrs?|hours?)\b/i;
const PAGE_CITE = /\bp\.\s*\d|page\s+\d/i;

function isolationNotice(v: ReturnType<typeof judge>): string {
  if (v.ok) return "";
  const idx = v.replacement.indexOf("\n\n");
  return idx === -1 ? v.replacement : v.replacement.slice(0, idx);
}

describe("#4858 hands-on answers get the isolation notice", () => {
  it.each(HANDS_ON)("prepends the notice and keeps the answer: %s", (text) => {
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("hazard_warning");
    expect(v.violation).toBe("hazard-warning:isolation-advisory");
    expect(v.replacement).toMatch(DISCONNECT);
    expect(v.replacement).toMatch(LOCKOUT);
    expect(v.replacement).toMatch(VERIFY_DEAD);
    expect(v.replacement.endsWith(text)).toBe(true);
  });
});

describe("#4858 parameter-only answers stay silent", () => {
  it.each(PARAMETER_ONLY)("does not prepend the notice: %s", (text) => {
    expect(judge(text).ok).toBe(true);
  });
});

describe("#4858 the notice warns and never withholds", () => {
  it("serves every word of the candidate under the banner", () => {
    const text = HANDS_ON[0];
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.replacement.endsWith(text)).toBe(true);
    expect(v.replacement.startsWith(isolationNotice(v))).toBe(true);
  });
});

describe("#4858 already-isolated answers stay silent", () => {
  it.each([
    "De-energize, lock out per site procedure, and verify absence of voltage. Then replace the input fuse.",
    "With the drive locked out, open the cover and replace the fan.",
    "Isolate the feeder, apply lockout/tagout, and confirm zero voltage. Then rewire the motor terminals.",
    "De-energize the drive. Then replace the input fuse.",
    "Isolate the feeder. Then replace the fuse.",
    "1. With the drive locked out, check the input fuse for continuity.\n2. Inspect the terminals for loose or burnt wiring.",
    "Leave the machine on while you read the alarm, lock it out, then repair the seal bar.",
  ])("does not prepend: %s", (text) => {
    expect(judge(text).ok).toBe(true);
  });
});

describe("#4858 isolation after, negated, or adjectival does not silence", () => {
  it.each([
    "Do not lock out. Replace the input fuse.",
    "Replace the input fuse. Then lock out.",
    "Replace the fuse, then lock it out.",
    "Replace the isolated analog input module.",
    "The drive is not isolated. Replace the fuse.",
    "Skip lockout. Replace the fuse.",
    "Before you lock it out, replace the fuse.",
    "Do not lock out, replace the fuse.",
    "Replace the fuse, then measure with the circuit isolated.",
    "Disconnect the incoming lugs.",
    "Disconnect the power wires.",
    "With the isolated analog input module, check the terminals.",
    "You cannot lock out. Replace the fuse.",
    "Lock out the drive. Restore power. Replace the fuse.",
    "The analog input shows no voltage. Replace the input fuse.",
  ])("still prepends: %s", (text) => {
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("hazard-warning:isolation-advisory");
    expect(v.replacement.endsWith(text)).toBe(true);
  });
});

describe("#4858 comma / then instruction shapes still fire", () => {
  it.each([
    "Bus overvoltage can also be caused by motor regeneration, then install the dynamic brake option [1].",
    "If that fails, install the dynamic brake option [1].",
  ])("prepends: %s", (text) => {
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violation).toBe("hazard-warning:isolation-advisory");
  });
});

describe("#4858 general-lane hands-on gets the same notice", () => {
  it("a grounded-lane rule on the shared validateAnswer tail", () => {
    const text = "Replace the input fuse.";
    const v = validateAnswer({
      answerText: text,
      question: Q,
      general: true,
      served: true,
      refused: false,
      evidenceSufficient: true,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("hazard_warning");
    expect(v.replacement.endsWith(text)).toBe(true);
  });
});

describe("#4858 VFD / DC-bus work mentions a discharge wait without inventing minutes", () => {
  it("the D4 install-brake answer names the wait as follow-the-manual", () => {
    const v = judge(HANDS_ON[0]);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const notice = isolationNotice(v);
    expect(notice).toMatch(DISCHARGE_WAIT);
    expect(notice).not.toMatch(INVENTED_MINUTES);
    expect(notice).not.toMatch(PAGE_CITE);
  });

  it("an answer that already cites PF525 p.13 still does not invent minutes", () => {
    const text =
      "Install the dynamic brake option on the DC bus. The PF525 manual (p.13) states the discharge wait [1].";
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const notice = isolationNotice(v);
    expect(notice).toMatch(DISCONNECT);
    expect(notice).not.toMatch(INVENTED_MINUTES);
    // The banner itself is uncited site practice; a page number in the
    // *answer* is the model's citation, not ours.
    expect(notice).not.toMatch(PAGE_CITE);
    expect(v.replacement.endsWith(text)).toBe(true);
  });

  it("mechanical-only work does not add a DC-bus discharge wait", () => {
    const v = judge("Replace the worn belt.");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(isolationNotice(v)).not.toMatch(DISCHARGE_WAIT);
  });
});

describe("#4858 the banner is uncited site practice", () => {
  it("names disconnect / lock out / verify-dead and cites no page", () => {
    const v = judge("Replace the input fuse.");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const notice = isolationNotice(v);
    expect(notice).toMatch(/^⚠️/);
    expect(notice).toMatch(DISCONNECT);
    expect(notice).toMatch(LOCKOUT);
    expect(notice).toMatch(VERIFY_DEAD);
    expect(notice).not.toMatch(PAGE_CITE);
    expect(notice).not.toMatch(INVENTED_MINUTES);
  });
});

describe("Codex #4867 r1 — isolation scope and software targets", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: a software shutdown or a named lockout procedure does not isolate the fuse", () => {
    flagged("Shut down the HMI. Replace the input fuse.");
    flagged("The lockout procedure is in the manual. Replace the input fuse.");
  });
  it("F1 controls: a real lockout still scopes the work", () => {
    silent("Lock out the drive. Then replace the input fuse.");
    silent("Follow the lockout procedure. Then replace the input fuse.");
  });
  it("F2: software, parameter and record targets get no disconnect-power notice", () => {
    silent("Install the firmware update.");
    silent("Change the fan speed parameter.");
    silent("Remove the fault from the alarm history.");
  });
  it("F2 controls: the physical twins stay flagged", () => {
    flagged("Install the control card.");
    flagged("Change the fan.");
  });
});

describe("Codex #4867 r2 + owner decision #5055", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: fault isolation and a lockout indicator are not power isolation", () => {
    flagged("Isolate the fault. Replace the input fuse.");
    flagged("The lockout indicator is off. Replace the fuse.");
    silent("Lock out the drive. Then replace the input fuse.");
  });
  it("F2: a physical head noun stays hands-on even beside a software word", () => {
    flagged("Replace the firmware module.");
    flagged("Disconnect the motor driver wires.");
    flagged("Replace the fan with a model matching the drive configuration.");
    silent("Install the firmware update.");
    silent("Change the fan speed parameter.");
    silent("Remove the fault from the alarm history.");
  });
  it("owner #5055: a live test or measurement gets no disconnect-power notice", () => {
    silent("Measure voltage across L1 and L2.");
    silent("Measure the actual line voltage at the input terminals.");
    silent("Read the voltage from the drive display.");
    // Dead tests are done isolated and keep the notice.
    flagged("Measure the resistance across the motor terminals.");
    silent("Probe the terminals for voltage.");
    // The measurand must be what is measured, not a word inside a part name.
    flagged("Check the current transformer wires.");
    flagged("Check the voltage, then replace the fuse.");
  });
  it("F4: work after power is restored needs a renewed lockout", () => {
    flagged("Lock out the drive. Replace the fan. Restore power. Replace the fuse.");
    silent("Lock out the drive. Replace the fan. Restore power. Lock out the drive again. Replace the fuse.");
  });
});

describe("Codex #4867 r3", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: a lockout switch / signal isolation is not energy isolation", () => {
    flagged("The lockout switch is defective. Replace the fuse.");
    flagged("Isolate the signal. Replace the fuse.");
    silent("Apply your lockout device to the disconnect. Then replace the fuse.");
  });
  it("F3: manner adverbs do not break the live-measurement decision (owner #5055)", () => {
    silent("Measure voltage directly across the input terminals.");
    silent("Measure the line voltage carefully at the input terminals.");
  });
  it("F4: work after a restore inside one sentence needs renewed isolation", () => {
    flagged("Lock out the drive. Replace the fan, restore power, then replace the fuse.");
    silent("Lock out the drive. Replace the fan, restore power, then check the display.");
  });
  it("F5: citation markers do not change the decision", () => {
    silent("Install the firmware update [1].");
    silent("Change the fan speed parameter [1].");
    flagged("Install the control card [1].");
  });
});

describe("Codex #4867 r4 — affirmative energy isolation, ordered walk, bounded object", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: only affirmative equipment-energy isolation opens the scope", () => {
    flagged("Isolate the control signal. Replace the fuse.");
    flagged("The lockout timer has expired. Replace the fuse.");
    flagged("If you are locked out of the HMI, replace the fuse.");
    silent("Isolate the drive. Replace the fuse.");
    silent("Perform LOTO. Then replace the fuse.");
    silent("With the conveyor under lockout, replace the fuse.");
  });
  it("F4: every isolation, restoration and work action is walked in order", () => {
    flagged("Lock out the drive. Replace the fan, restore power, then lock out the drive, replace the fuse, restore power, then replace the contactor.");
    silent("Lock out the drive. Replace the fan, restore power, then lock out the drive, replace the fuse.");
  });
  it("F7: a later temporal software clause does not hide the repair", () => {
    flagged("Replace the fuse after checking the parameters.");
    flagged("Replace the fuse after reviewing the configuration.");
    flagged("Replace the fuse before changing the settings.");
    silent("Change the settings.");
  });
});

describe("Codex #4867 r5", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: a powered-off HMI and a lockout indicator are not isolation", () => {
    flagged("The HMI is powered off. Replace the fuse.");
    flagged("Use the lockout indicator to locate the drive. Replace the fuse.");
    silent("The drive is powered off. Replace the fuse.");
    silent("Perform lockout. Replace the fuse.");
    silent("Follow the lockout procedure, then replace the fuse.");
  });
  it("F7: an alternative software clause does not hide the repair", () => {
    flagged("Replace the fuse or change the settings.");
    silent("Change the settings.");
  });
  it("F8: a dead test naming a voltage part keeps the notice; the live reading stays silent", () => {
    flagged("Measure the terminal resistance for the voltage sensor.");
    silent("Probe the terminals for voltage.");
    silent("Measure the line voltage at the input terminals.");
  });
});

describe("Codex #4867 r6", () => {
  const flagged = (t: string) => expect(judge(t)).toMatchObject({ ok: false, violation: "hazard-warning:isolation-advisory" });
  const silent = (t: string) => expect(judge(t)).toEqual({ ok: true });
  it("F1: an isolated state needs an equipment / energy subject", () => {
    flagged("The control signal is isolated. Replace the input fuse.");
    flagged("The HMI is isolated. Replace the fuse.");
    silent("The drive is isolated. Replace the fuse.");
    silent("The conveyor has been locked out. Replace the fuse.");
  });
  it("F7: a comma-separated settings edit does not hide the repair", () => {
    flagged("Replace the fuse, change the settings.");
  });
  it("F10: a negated isolation state opens no scope", () => {
    flagged("The drive has not been locked out. Replace the fuse.");
    flagged("The drive is not yet isolated. Replace the fuse.");
    flagged("The drive isn't de-energized. Replace the fuse.");
    silent("The drive is now de-energized. Replace the fuse.");
  });
});
