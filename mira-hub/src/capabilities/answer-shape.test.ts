import { describe, expect, it } from "vitest";
import { ISOLATION_STEP_RULE, normalizeCitationMarkers, withStepSafety } from "@/capabilities/answer-shape";

describe("normalizeCitationMarkers", () => {
  it("turns every provider marker form into [n]", () => {
    expect(normalizeCitationMarkers("0x2001【1】 and 9600【2†L3-L4】 and 【 3 】")).toBe("0x2001[1] and 9600[2] and [3]");
  });
  it("leaves plain text and [n] untouched", () => {
    expect(normalizeCitationMarkers("Write 300 for 30 Hz [1].")).toBe("Write 300 for 30 Hz [1].");
  });
});

describe("withStepSafety", () => {
  it("appends the inline-isolation rule", () => {
    const out = withStepSafety("SYS");
    expect(out.startsWith("SYS\n\n")).toBe(true);
    expect(out).toContain(ISOLATION_STEP_RULE);
    expect(ISOLATION_STEP_RULE).toMatch(/inline in THAT step/);
  });
});
