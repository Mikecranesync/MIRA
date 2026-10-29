// #4372 (Mike decisions 1 + 4): NOTEBOOK_SAFETY_FLOORS_MODE=shadow keeps the
// #4929/#4931 floors' detection but serves them as non-blocking flags, so the
// isolated route can evaluate them in BOTH modes. Default stays enforce.

import { afterEach, describe, expect, it } from "vitest";
import {
  DISCHARGE_WAIT_VIOLATION,
  safetyFloorsMode,
  shadowSafetyFloor,
  validateAnswer,
} from "@/capabilities/answer-validation";
import { SAFETY_STOP } from "@/lib/safety-classifier";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

const UNSAFE = "Reset the E-12 fault while the machine is energized. This clears the error [1].";
const DC_Q = "how long do I wait for the dc bus capacitors to discharge after power off";
const DC_A = "Wait 5 minutes after removing power before touching the DC bus.";

function validate(answerText: string, question: string) {
  return validateAnswer({ answerText, question, general: false, served: true, refused: false, sourceTexts: [] });
}

describe("safetyFloorsMode", () => {
  it("is enforce unless the env says exactly shadow", () => {
    delete process.env.NOTEBOOK_SAFETY_FLOORS_MODE;
    expect(safetyFloorsMode()).toBe("enforce");
    for (const v of ["", "SHADOW", "shadow ", "off", "0", "enforce"]) {
      process.env.NOTEBOOK_SAFETY_FLOORS_MODE = v;
      expect(safetyFloorsMode()).toBe("enforce");
    }
    process.env.NOTEBOOK_SAFETY_FLOORS_MODE = "shadow";
    expect(safetyFloorsMode()).toBe("shadow");
  });
});

describe("shadowSafetyFloor", () => {
  it("precondition: the #4931 floor blocks this candidate with SAFETY_STOP", () => {
    const v = validate(UNSAFE, "How do I clear the E-12 fault?");
    expect(v).toMatchObject({ ok: false, kind: "unsafe_answer", replacement: SAFETY_STOP });
  });

  it("enforce: never changes a block", () => {
    const v = validate(UNSAFE, "How do I clear the E-12 fault?");
    expect(shadowSafetyFloor(v, UNSAFE, "enforce")).toBeNull();
  });

  it("shadow: a #4931 block is served as the quoted-step flag above the candidate", () => {
    const v = validate(UNSAFE, "How do I clear the E-12 fault?");
    const s = shadowSafetyFloor(v, UNSAFE, "shadow");
    expect(s?.wouldBlock).toBe(v.ok ? "" : v.violation);
    expect(s?.servedText.startsWith("⚠️ **Safety flag on a step below:**")).toBe(true);
    expect(s?.servedText.endsWith(UNSAFE)).toBe(true);
    expect(s?.servedText).not.toContain(SAFETY_STOP);
  });

  it("shadow: the #4929 discharge-wait block serves the candidate unchanged", () => {
    const v = validate(DC_A, DC_Q);
    expect(v).toMatchObject({ ok: false, violation: DISCHARGE_WAIT_VIOLATION });
    expect(shadowSafetyFloor(v, DC_A, "shadow")).toEqual({ wouldBlock: DISCHARGE_WAIT_VIOLATION, servedText: DC_A });
    expect(shadowSafetyFloor(v, DC_A, "enforce")).toBeNull();
  });

  it("shadow: leaves passing answers and other rules alone", () => {
    expect(shadowSafetyFloor({ ok: true }, "fine", "shadow")).toBeNull();
    const other = {
      ok: false as const,
      kind: "unsupported_specificity" as const,
      violation: "unsupported-specificity:exact-rating",
      detail: "x",
      replacement: "r",
    };
    expect(shadowSafetyFloor(other, "a", "shadow")).toBeNull();
  });
});
