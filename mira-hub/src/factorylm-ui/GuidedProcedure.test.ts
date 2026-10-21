// WP-1 panel: unsent readings and notes survive a failed save (Codex #4573 F9).
import { describe, expect, it } from "vitest";
import { askMiraButton, draftsAfterSave } from "./GuidedProcedure";

const drafts = { readings: { "L1-T1": "12000", "L2-T2": "5000", "L3-T3": "8000" }, note: "fan was blocked" };

describe("draftsAfterSave", () => {
  it("keeps the technician's entries when the save failed (503, 422, offline)", () => {
    expect(draftsAfterSave(false, drafts)).toEqual(drafts);
  });
  it("clears them once the answer is saved (control)", () => {
    expect(draftsAfterSave(true, drafts)).toEqual({ readings: {}, note: "" });
  });
});

describe("askMiraButton (#4575)", () => {
  it("is disabled and says why while a chat reply is streaming", () => {
    const b = askMiraButton(true);
    expect(b.disabled).toBe(true);
    expect(b.label).toMatch(/still answering/);
  });
  it("is enabled when chat is idle (control)", () => {
    expect(askMiraButton(false)).toEqual({ disabled: false, label: "Ask MIRA about this (beyond the manual)" });
  });
});
