/**
 * Red-first tests for JobSheetsLibrary.tsx (TASK-S4 UI slice: find a job
 * sheet template, import Mike's spreadsheet with a preview-before-save
 * step, mark a draft reviewed). Same no-jsdom pattern: the component's own
 * data fetch and import/save flows live behind useState/useEffect/fetch, so
 * only the static SSR shape is asserted here — `job-sheet-library-logic.ts`
 * (searchJobSheets/draftBadge/previewRows) already has its own full pure
 * test suite and is not duplicated.
 *
 * `initialMode` is a test-only escape hatch so the import tab's static copy
 * (the "### <Tab name>" helper text) is reachable under renderToStaticMarkup,
 * which never runs the click handler that would normally switch tabs.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobSheetsLibrary } from "../JobSheetsLibrary";

function bannedWordRegex(phrase: string): RegExp {
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

describe("JobSheetsLibrary (SSR shape)", () => {
  it("renders the header, Find/Import tabs, search field, and close control before the fetch resolves", () => {
    const html = renderToStaticMarkup(<JobSheetsLibrary onClose={() => {}} />);
    expect(html).toContain("Job sheets");
    expect(html).toContain("Find a job");
    expect(html).toContain("Import");
    expect(html).toContain("Close");
  });

  it("the import tab explains the ### <Tab name> paste format and has a paste box", () => {
    const html = renderToStaticMarkup(<JobSheetsLibrary onClose={() => {}} initialMode="import" />);
    // React/ReactDOMServer HTML-escapes literal `<`/`>` in text content — the
    // escaped form is the correct, safe rendering of this literal string.
    expect(html).toContain("### &lt;Tab name&gt;");
    expect(html).toContain("Preview");
  });

  it("never renders a banned word in its own static copy", () => {
    const browseHtml = renderToStaticMarkup(<JobSheetsLibrary onClose={() => {}} />);
    const importHtml = renderToStaticMarkup(<JobSheetsLibrary onClose={() => {}} initialMode="import" />);
    for (const phrase of ["fixed", "safe", "repaired", "resolved"]) {
      expect(bannedWordRegex(phrase).test(browseHtml)).toBe(false);
      expect(bannedWordRegex(phrase).test(importHtml)).toBe(false);
    }
  });
});
