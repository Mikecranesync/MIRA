/**
 * #4858 (PR #4867) layered onto #4471 (PR #4931) — owner decision 4/7,
 * 2026-10-29: #4471 blocking takes priority. Every #4471 terminal block
 * (unsafe_answer → SAFETY_STOP) still wins, and the isolation notice is added
 * ONLY to answers that pass every #4471 check.
 *
 * Each STOP row is the hands-on control ("Replace the input fuse.", which
 * alone draws the notice) plus exactly one #4471 hazard shape, so the row
 * fails if the notice is checked before the A-rules.
 *
 * Run: cd mira-hub && npx vitest run src/capabilities/answer-validation-isolation-layering
 */
import { describe, expect, it } from "vitest";
import { SAFETY_STOP } from "@/lib/safety-classifier";
import { validateAnswer } from "@/capabilities/answer-validation";
import { ISOLATION_BANNER } from "@/capabilities/isolation-advisory";

const Q = "The PF525 tripped on F005 OverVoltage. What should I do?";
const judge = (answerText: string, general = false) =>
  validateAnswer({ answerText, question: Q, general, served: true, refused: false, evidenceSufficient: true });

const CONTROL = "Replace the input fuse.";

const STOP_ROWS: readonly [string, string][] = [
  ["Replace the input fuse while the drive remains energized.", "unsafe-answer:imperative-energized-action"],
  ["Yes, you can replace the input fuse while the drive is still energized [1].", "unsafe-answer:affirm-energized-work"],
  [
    "Lock out the drive, then re-energize the control supply under lockout and replace the input fuse.",
    "unsafe-answer:lockout-step-contradiction",
  ],
  // (A lockout-live-measurement row is deliberately absent: its lockout comes
  // before the work, so the notice would not fire even if checked first —
  // it could not fail under the hoist mutation.)
  ["Bypass the safety interlock and replace the input fuse.", "unsafe-answer:disable-safety-device"],
];

describe("layering control — the hands-on answer alone gets the notice", () => {
  it.each([false, true])("general=%s: isolation_advisory, candidate kept under the banner", (general) => {
    const v = judge(CONTROL, general);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("isolation_advisory");
    expect(v.replacement.startsWith(ISOLATION_BANNER)).toBe(true);
    expect(v.replacement.endsWith(CONTROL)).toBe(true);
  });
});

describe("layering — every #4471 SAFETY_STOP wins over the notice", () => {
  it.each(STOP_ROWS)("%s → SAFETY_STOP (%s), no notice", (text, violation) => {
    const v = judge(text);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("unsafe_answer");
    expect(v.violation).toBe(violation);
    expect(v.replacement).toBe(SAFETY_STOP);
    expect(v.replacement).not.toContain(ISOLATION_BANNER);
  });
});

describe("layering — the energized warning (written restore) is not doubled with the notice", () => {
  it("restore-then-measure + hands-on stays energized_warning only", () => {
    const v = judge("Restore power and measure the supply voltage at the input terminals, then replace the input fuse.");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("energized_warning");
    expect(v.replacement).not.toContain(ISOLATION_BANNER);
  });
});

describe("advisory word boundary — a third-person verb inside isolation language is not an instruction", () => {
  it("the alarm-card site-procedure line stays silent", () => {
    expect(
      judge("Anything that opens an enclosure or touches the circuit follows your site's lockout procedure with the equipment out of service."),
    ).toEqual({ ok: true });
  });
  it("control: the imperative form still draws the notice", () => {
    const v = judge("Open the enclosure or touch the circuit terminals.");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.kind).toBe("isolation_advisory");
  });
});
