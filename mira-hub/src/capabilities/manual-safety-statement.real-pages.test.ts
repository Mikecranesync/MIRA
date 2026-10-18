/**
 * #4508 — the extractor over the REAL text of all 50 Stranger Walk answer pages.
 *
 * Run: npx vitest run src/capabilities/manual-safety-statement.real-pages.test.ts
 *
 * Fixture: `manual-safety-statement.real-pages.json`. Built from
 * `pdftotext -layout -f P -l P <manual>.pdf -` on each corpus question's
 * `expectedPage` (manual sha256s match corpus.json). Only the paragraphs that
 * contain a marker or hazard-prose keyword are kept (intra-line whitespace
 * collapsed); the extractor returns the same result on those excerpts as on
 * the full pages (checked when the fixture was built: 0/50 differences).
 */
import { describe, expect, it } from "vitest";
import pages from "./manual-safety-statement.real-pages.json";
import { extractManualSafetyStatement } from "./manual-safety-statement";

type Page = { id: string; safety: boolean; text: string };
const ALL = pages as Page[];

/** Expected marker per page; null = no statement. */
const SAFETY_EXPECTED: Record<string, string | null> = {
  "acs355-q2": "WARNING",
  "acs355-q3": "WARNING",
  // ACS355 p.355 (alarm 2035 SAFE TORQUE OFF) states no hazard on the page.
  "acs355-q4": null,
  "e3plus-q4": "ATTENTION",
  "e3plus-q5": "ATTENTION",
  "gs10-ch6-q2": "WARNING (manual text)",
  "gs10-ch6-q5": "CAUTION",
  "micro820-in-q5": "WARNING",
  "micro820-um-q4": "WARNING",
  "ml1100-q4": "ATTENTION",
  "pf40-q2": "ATTENTION",
  "pf4m-q2": "ATTENTION",
  "smc50-q3": "WARNING (manual text)",
  "smc50-q5": "ATTENTION",
  "smcflex-q3": "SHOCK HAZARD",
};
const CONTROLS_WITH_MARKER: Record<string, string> = {
  "pf40-q3": "ATTENTION",
  "ml1100-q2": "ATTENTION",
  "smcflex-q2": "ATTENTION",
};

describe("manual safety statements on the real corpus pages", () => {
  it("precondition: 50 pages, 15 safety-relevant, ids match the expectations", () => {
    expect(ALL).toHaveLength(50);
    expect(ALL.filter((p) => p.safety).map((p) => p.id).sort()).toEqual(Object.keys(SAFETY_EXPECTED).sort());
  });

  for (const [id, marker] of Object.entries(SAFETY_EXPECTED)) {
    it(`safety page ${id} → ${marker ?? "null"}`, () => {
      const page = ALL.find((p) => p.id === id)!;
      const hit = extractManualSafetyStatement(page.text);
      if (marker === null) {
        expect(hit).toBeNull();
      } else {
        expect(hit?.marker).toBe(marker);
        expect(hit!.statement.length).toBeGreaterThan(20);
        expect(hit!.statement).not.toMatch(/^[:!]/);
      }
    });
  }

  it("14 of 15 safety pages extract", () => {
    const hits = ALL.filter((p) => p.safety && extractManualSafetyStatement(p.text) !== null);
    expect(hits).toHaveLength(14);
  });

  it("among the 35 controls, exactly pf40-q3, ml1100-q2 and smcflex-q2 extract", () => {
    const controls = ALL.filter((p) => !p.safety);
    expect(controls).toHaveLength(35);
    const hits = Object.fromEntries(
      controls.flatMap((p) => {
        const hit = extractManualSafetyStatement(p.text);
        return hit ? [[p.id, hit.marker]] : [];
      }),
    );
    expect(hits).toEqual(CONTROLS_WITH_MARKER);
  });
});
