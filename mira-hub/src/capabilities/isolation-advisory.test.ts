/**
 * #4858 — isolation-safety framing for hands-on answers.
 *
 * Detector + banner wording, the restart-advisory.test.ts twin. The
 * validateAnswer eval set lives in answer-validation-isolation-advisory.test.ts.
 *
 * Run: npx vitest run src/capabilities/isolation-advisory.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  DISCHARGE_WAIT_LINE,
  ISOLATION_BANNER,
  directsHandsOnWork,
  isolationBannerFor,
} from "./isolation-advisory";

describe("directsHandsOnWork — answers that must get the isolation notice", () => {
  const POSITIVE = [
    "Replace the input fuse.",
    "Open the drive cover.",
    "Install the dynamic brake option.",
    "Bus overvoltage: extend the decel time or install the dynamic brake option [1].",
    "Bus overvoltage is regen, then install the dynamic brake option [1].",
    "If that fails, install the dynamic brake option [1].",
    "Also install the dynamic brake option.",
    "Otherwise install the dynamic brake option.",
    "You have to replace the input fuse.",
    "Disconnect the incoming lugs.",
    "1. Rewire the motor terminals.",
    "Replace the worn belt.",
    "Do not lock out. Replace the input fuse.",
    "Replace the isolated analog input module.",
  ];
  for (const a of POSITIVE) it(`flags: "${a}"`, () => expect(directsHandsOnWork(a)).toBe(true));
});

describe("directsHandsOnWork — parameter-only and look-alikes stay unflagged", () => {
  const NEGATIVE = [
    "Extend the decel time.",
    "Change P043 from 5 to 15.",
    "Adjust the current limit.",
    "Bus overvoltage can also be caused by motor regeneration, so extend the decel time [1].",
    "After the repair, re-energize and confirm the drive comes up without a fault.",
    "It is not safe to open the cabinet while the drive is powered on.",
    "Never replace the fuse while the drive is energized.",
    "Leave the machine on and open the HMI alarm history.",
    "Work on the parameter set.",
    "Connect the laptop to the drive.",
    "Check the parameter set, then inspect the terminals.",
    "Change P043 from 5 to 15 so the fuse does not open.",
    "Adjust the current limit to keep the terminals from overheating.",
    "",
  ];
  for (const a of NEGATIVE) it(`does not flag: "${a}"`, () => expect(directsHandsOnWork(a)).toBe(false));
});

describe("isolation-safety wording", () => {
  it("the banner says disconnect per the manual, lock out per site procedure, verify dead", () => {
    expect(ISOLATION_BANNER).toMatch(/^⚠️/);
    expect(ISOLATION_BANNER).toMatch(/disconnect power per the manual/i);
    expect(ISOLATION_BANNER).toMatch(/lock out per site procedure/i);
    expect(ISOLATION_BANNER).toMatch(/absence of voltage/i);
  });
  it("the banner cites no manual page and invents no wait time", () => {
    expect(ISOLATION_BANNER).not.toMatch(/\bp\.\s*\d|page\s+\d/i);
    expect(ISOLATION_BANNER).not.toMatch(/\b\d+\s*(?:min|minutes?|seconds?)\b/i);
    expect(DISCHARGE_WAIT_LINE).toMatch(/follow the manual's discharge wait/i);
    expect(DISCHARGE_WAIT_LINE).not.toMatch(/\b\d+\s*(?:min|minutes?|seconds?)\b/i);
  });
  it("already-isolated hands-on work stays silent", () => {
    expect(
      isolationBannerFor("Lock out the drive. Then replace the input fuse."),
    ).toBeNull();
    expect(isolationBannerFor("De-energize the drive. Then replace the input fuse.")).toBeNull();
  });
  it("a negated or later lockout does not count as already isolated", () => {
    expect(isolationBannerFor("Do not lock out. Replace the input fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Replace the input fuse. Then lock out.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Replace the fuse, then lock it out.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("The drive is not isolated. Replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Skip lockout. Replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Before you lock it out, replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Do not lock out, replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Replace the fuse, then measure with the circuit isolated.")).toBe(
      ISOLATION_BANNER,
    );
    expect(isolationBannerFor("You cannot lock out. Replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Until you lock it out, replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Lockout is not possible. Replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Lock out the drive. Restore power. Replace the fuse.")).toBe(
      ISOLATION_BANNER,
    );
    expect(isolationBannerFor("The lockout is removed. Replace the input fuse.")).toBe(
      ISOLATION_BANNER,
    );
    expect(isolationBannerFor("After the lockout is removed, replace the fuse.")).toBe(
      ISOLATION_BANNER,
    );
    expect(isolationBannerFor("The analog input shows no voltage. Replace the input fuse.")).toBe(
      ISOLATION_BANNER,
    );
  });
  it("disconnect of a work object is the work, not the isolation", () => {
    expect(isolationBannerFor("Disconnect the incoming lugs.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Disconnect the wires and replace the fuse.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Disconnect the power wires.")).toBe(ISOLATION_BANNER);
    expect(isolationBannerFor("Disconnect power. Then replace the fuse.")).toBeNull();
  });
  it("a described locked-out state gets the notice (#4867 simple rule)", () => {
    expect(
      isolationBannerFor(
        "1. With the drive locked out, check the input fuse for continuity.\n2. Inspect the terminals for loose or burnt wiring.",
      ),
    ).toBe(ISOLATION_BANNER);
  });
  it("same-step isolation instruction before the work stays silent, including lock-it-out", () => {
    expect(
      isolationBannerFor(
        "Leave the machine on while you read the alarm, lock it out, then repair the seal bar.",
      ),
    ).toBeNull();
    expect(
      isolationBannerFor(
        "Measure resistance across the terminals with the circuit isolated and locked out then restore power.",
      ),
    ).toBe(ISOLATION_BANNER);
  });
  it("DC-bus work adds the follow-the-manual discharge wait", () => {
    const banner = isolationBannerFor(
      "Install the dynamic brake option on the DC bus [1].",
    );
    expect(banner).toContain(ISOLATION_BANNER);
    expect(banner).toContain(DISCHARGE_WAIT_LINE);
  });
  it("a communications bus is not a DC-bus discharge wait", () => {
    const banner = isolationBannerFor("Replace the CAN bus connector.");
    expect(banner).toBe(ISOLATION_BANNER);
    expect(banner).not.toContain(DISCHARGE_WAIT_LINE);
  });
  it("a hyphenated DC-bus is stored-energy work", () => {
    const banner = isolationBannerFor("Install the resistor on the DC-bus.");
    expect(banner).toContain(ISOLATION_BANNER);
    expect(banner).toContain(DISCHARGE_WAIT_LINE);
  });
  it("mechanical-only work does not add a discharge wait", () => {
    expect(isolationBannerFor("Replace the worn belt.")).toBe(ISOLATION_BANNER);
  });
});

describe("#4858 — a descriptive third-person verb is not a work instruction", () => {
  // The alarm card's own site-procedure line (alarm-card.ts) must not be read as
  // "touch the circuit": the card is look-and-read only and already names lockout.
  it("the alarm card's lockout reminder gets no banner", () => {
    const line = "Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service.";
    expect(directsHandsOnWork(line)).toBe(false);
    expect(isolationBannerFor(line)).toBeNull();
  });
  it("control: the imperative still does", () => {
    expect(isolationBannerFor("Open the enclosure or touch the circuit to find the loose wire.")).not.toBeNull();
  });
});
