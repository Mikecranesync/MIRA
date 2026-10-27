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
    "With the isolated analog input module, check the terminals.",
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
