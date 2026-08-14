// CIT-07 phase 2 — the quote window must contain the claim, not the chunk head.
import { describe, it, expect } from "vitest";
import { relevantQuoteWindow, queryTerms } from "../quote-window";

const CHUNK = [
  "PowerFlex 525 Mini Reference.",
  "Fault F004 (UnderVoltage) indicates the DC bus voltage fell below the minimum threshold.",
  "Check incoming line power, verify input fuses, and confirm supply voltage is within tolerance before resetting.",
  "Terminal torque: control I/O terminal block screw torque specification is 0.71 N-m (6.2 lb-in).",
  "Fault F005 (OverVoltage) indicates the DC bus exceeded the maximum.",
  "Check for high line voltage or a deceleration time that is too short.",
].join(" ");

describe("relevantQuoteWindow", () => {
  it("centers on the claim the question asks about (the 2026-08-13 QA miss)", () => {
    const q = relevantQuoteWindow(CHUNK, "What is the terminal block screw torque?");
    expect(q).toContain("0.71");
    expect(q.length).toBeLessThanOrEqual(242); // span + leading ellipsis
  });
  it("different question, different window — same deterministic chunk", () => {
    const q = relevantQuoteWindow(CHUNK, "What does fault F005 mean?");
    expect(q).toContain("F005");
    expect(relevantQuoteWindow(CHUNK, "What does fault F005 mean?")).toBe(q); // deterministic
  });
  it("digit-bearing short tokens count as terms (f004, 0.71)", () => {
    expect(queryTerms("clear F004 at 0.71")).toEqual(
      expect.arrayContaining(["f004", "0.71"]),
    );
  });
  it("falls back to the head when nothing matches", () => {
    const q = relevantQuoteWindow(CHUNK, "zzz qqq unrelated");
    expect(q.startsWith("PowerFlex 525 Mini Reference.")).toBe(true);
  });
  it("short chunks return whole, untruncated", () => {
    expect(relevantQuoteWindow("Short text.", "anything")).toBe("Short text.");
  });
  it("never opens mid-word when windowed", () => {
    const q = relevantQuoteWindow(CHUNK, "deceleration time too short");
    if (q.startsWith("…")) {
      expect(q.charAt(1)).not.toBe(" ");
      expect(/^…\S/.test(q)).toBe(true);
    }
    expect(q).toContain("deceleration");
  });
});
