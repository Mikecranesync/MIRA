/**
 * #4645 defect 1 — a reset / restart-after-fault question gets restart-safety
 * framing. Staging, TP700 Comfort manual: 0 of 16 fault-reset answers said to
 * find the cause first, keep people clear, or lock out before reaching in.
 *
 * The detector is deliberately narrow: a reset or acknowledge verb next to a
 * fault-type object, or a restart phrase with a fault/stop context. Its
 * controls pin the look-alikes that must stay unflagged (passwords, factory
 * reset, counters, alarm history, the ACK definition question).
 *
 * Run: npx vitest run src/capabilities/restart-advisory.test.ts
 */
import { describe, expect, it } from "vitest";
import { RESTART_BANNER, RESTART_DIRECTIVE, isFaultResetAsk } from "./restart-advisory";

describe("isFaultResetAsk — questions that must get restart-safety framing", () => {
  const POSITIVE = [
    // The #4645 staging questions (verbatim where the reviewer gave them).
    "How do I clear a fault on the panel?",
    "How do I acknowledge an alarm?",
    "The machine faulted and stopped. How do I reset the fault and get it running again?",
    "How do I reset an alarm on this panel?",
    "How do I clear an alarm message on the TP700?",
    "What is the procedure to reset a fault?",
    // Ordinary technician phrasings.
    "How do I reset the E-12 fault?",
    "Can I reset the E-12 fault while it's still on?",
    "It tripped on overcurrent, how do I restart it?",
    "the conveyor stopped on an e-stop, how do I get it running again",
    "fault reset procedure for the drive",
    "how do i clear the trip on the vfd",
  ];
  for (const q of POSITIVE) it(`flags: "${q}"`, () => expect(isFaultResetAsk(q)).toBe(true));
});

describe("isFaultResetAsk — opposite-direction controls stay unflagged", () => {
  const NEGATIVE = [
    "How do I reset my password?",
    "How do I factory reset the HMI?",
    "What does the ACK key do?",
    "What is a fault code?",
    "What does F0003 mean?",
    "How do I reset the hour meter?",
    "How do I clear the alarm history?",
    "How do I clear the alarm buffer on the TP700?",
    "Restart my laptop",
    "What supply voltage does the TP700 Comfort use?",
    "",
  ];
  for (const q of NEGATIVE) it(`does not flag: "${q}"`, () => expect(isFaultResetAsk(q)).toBe(false));
});

describe("restart-safety wording", () => {
  it("the banner says cause first, people clear, and lock out before hands-in", () => {
    expect(RESTART_BANNER).toMatch(/^⚠️/);
    expect(RESTART_BANNER).toMatch(/cause/i);
    expect(RESTART_BANNER).toMatch(/clear/i);
    expect(RESTART_BANNER).toMatch(/lock out/i);
  });
  it("the banner cites no manual page — it is site safety practice, not a manual claim", () => {
    expect(RESTART_BANNER).not.toMatch(/\bp\.\s*\d|page\s+\d/i);
  });
  it("the directive forbids presenting a factory reset or OS update as a fault fix, and forbids inventing steps", () => {
    expect(RESTART_DIRECTIVE).toMatch(/factory reset/i);
    expect(RESTART_DIRECTIVE).toMatch(/operating.system|firmware/i);
    expect(RESTART_DIRECTIVE).toMatch(/do not invent/i);
  });
});
