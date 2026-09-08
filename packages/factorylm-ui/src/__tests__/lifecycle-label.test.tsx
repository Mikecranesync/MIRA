import { describe, expect, it } from "bun:test";

import { LIFECYCLES } from "@factorylm/interaction";

import { lifecycleLabel } from "../parts";

/**
 * Rendering half of the Lifecycle contract.
 *
 * `lifecycleLabel` was `charAt(0).toUpperCase() + slice(1)` — correct for nine
 * single-word members and producing **"Safety_stop"** for the tenth, at the
 * exact moment a technician is being told MIRA declined on safety grounds.
 */
describe("lifecycleLabel", () => {
  it("labels every declared lifecycle", () => {
    // Driven from LIFECYCLES, so a member added to the contract without a
    // label fails here as well as at compile time.
    for (const l of LIFECYCLES) {
      const label = lifecycleLabel(l);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("undefined");
    }
  });

  it("never shows a raw identifier to a technician", () => {
    // No underscores, no camelCase seams, no lowercase first letter.
    for (const l of LIFECYCLES) {
      const label = lifecycleLabel(l);
      expect(label).not.toContain("_");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("says 'Safety stop', not 'Stopped'", () => {
    // A person interrupting an answer and MIRA refusing to give one are
    // different events. Collapsing them tells the technician the wrong story
    // about why there is no answer.
    expect(lifecycleLabel("safety_stop")).toBe("Safety stop");
    expect(lifecycleLabel("safety_stop")).not.toBe(lifecycleLabel("stopped"));
  });

  it("gives every member a distinct label (positive control)", () => {
    // Without this, a map that returned one constant would pass everything
    // above except the last assertion.
    const labels = LIFECYCLES.map(lifecycleLabel);
    expect(new Set(labels).size).toBe(LIFECYCLES.length);
  });
});
