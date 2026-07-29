import { describe, it, expect } from "vitest";
import {
  isScheduleEmpty,
  exportsDisabledWhenEmpty,
  EMPTY_CTAS,
  EXPORT_EMPTY_HINT_KEY,
} from "./schedule-empty";

describe("isScheduleEmpty", () => {
  it("is empty once loading settles with no PMs", () => {
    expect(isScheduleEmpty([], false)).toBe(true);
  });

  it("is NOT empty while still loading (avoid flashing the card)", () => {
    expect(isScheduleEmpty([], true)).toBe(false);
  });

  it("is NOT empty when PMs exist", () => {
    expect(isScheduleEmpty([{ id: "PM-1" }], false)).toBe(false);
  });
});

describe("exportsDisabledWhenEmpty", () => {
  it("disables exports when there is nothing to export", () => {
    expect(exportsDisabledWhenEmpty([])).toBe(true);
  });

  it("enables exports once PMs exist", () => {
    expect(exportsDisabledWhenEmpty([{ id: "PM-1" }])).toBe(false);
  });
});

describe("EMPTY_CTAS", () => {
  it("points only at real, basePath-relative Hub routes (no hardcoded /hub)", () => {
    const hrefs = EMPTY_CTAS.map((c) => c.href);
    expect(hrefs).toEqual(["/documents", "/assets", "/knowledge/suggestions"]);
    for (const cta of EMPTY_CTAS) {
      expect(cta.href.startsWith("/hub")).toBe(false);
      expect(cta.labelKey).toMatch(/^empty/);
      expect(cta.testid).toMatch(/^schedule-empty-cta-/);
    }
  });

  it("omits a 'Create PM' CTA (no such route exists yet)", () => {
    expect(EMPTY_CTAS.some((c) => /create/i.test(c.labelKey) || c.href.includes("create"))).toBe(false);
  });

  it("exposes a stable export-hint key", () => {
    expect(EXPORT_EMPTY_HINT_KEY).toBe("exportEmptyHint");
  });
});
