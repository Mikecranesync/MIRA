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

  // #4122: staging isolation answers put one step both locked out and powered.
  it("separates isolated steps from energized ones (#4122)", () => {
    expect(ISOLATION_STEP_RULE).toMatch(/EITHER isolated OR energized, never both/);
    expect(ISOLATION_STEP_RULE).toMatch(/never by re-energizing/);
    expect(ISOLATION_STEP_RULE).toMatch(/its own later step that says the lockout is removed/);
    expect(ISOLATION_STEP_RULE).toMatch(/qualified person under the site's energized-work procedure/);
  });

  it("still teaches no voltage number anywhere in the rule (#4096)", () => {
    expect(ISOLATION_STEP_RULE).not.toMatch(/\d\s*V\b/);
  });
});
