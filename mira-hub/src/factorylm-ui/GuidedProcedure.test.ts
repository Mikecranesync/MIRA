// WP-1 panel: unsent readings and notes survive a failed save (Codex #4573 F9).
import { describe, expect, it } from "vitest";
import { askMiraButton, draftsAfterSave, titleRowReserveCss } from "./GuidedProcedure";

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

describe("titleRowReserveCss (pill over a long notebook title)", () => {
  it("reserves the pill's width plus its inset and a gap at the end of the shell's title row", () => {
    expect(titleRowReserveCss(160.4)).toBe(".hub-shell-host .fl-conversation .fl-conversation__bar{padding-inline-end:185px}");
  });
  it("outranks the shell's own .fl-conversation--aui .fl-conversation__bar padding (3 classes vs 2)", () => {
    const selector = titleRowReserveCss(100).split("{")[0];
    expect(selector.split(".").length - 1).toBe(3);
  });
});
