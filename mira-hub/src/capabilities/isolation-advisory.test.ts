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
    "1. Rewire the motor terminals.",
    "Replace the worn belt.",
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
  });
  it("DC-bus work adds the follow-the-manual discharge wait", () => {
    const banner = isolationBannerFor(
      "Install the dynamic brake option on the DC bus [1].",
    );
    expect(banner).toContain(ISOLATION_BANNER);
    expect(banner).toContain(DISCHARGE_WAIT_LINE);
  });
  it("mechanical-only work does not add a discharge wait", () => {
    expect(isolationBannerFor("Replace the worn belt.")).toBe(ISOLATION_BANNER);
  });
});
