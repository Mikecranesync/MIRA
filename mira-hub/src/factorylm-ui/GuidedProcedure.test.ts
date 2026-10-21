// WP-1 panel: unsent readings and notes survive a failed save (Codex #4573 F9).
import { describe, expect, it } from "vitest";
import { draftsAfterSave } from "./GuidedProcedure";

const drafts = { readings: { "L1-T1": "12000", "L2-T2": "5000", "L3-T3": "8000" }, note: "fan was blocked" };

describe("draftsAfterSave", () => {
  it("keeps the technician's entries when the save failed (503, 422, offline)", () => {
    expect(draftsAfterSave(false, drafts)).toEqual(drafts);
  });
  it("clears them once the answer is saved (control)", () => {
    expect(draftsAfterSave(true, drafts)).toEqual({ readings: {}, note: "" });
  });
});
