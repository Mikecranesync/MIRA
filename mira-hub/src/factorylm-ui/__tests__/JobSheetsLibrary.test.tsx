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
import { JobSheetsLibrary, RecipeReview } from "../JobSheetsLibrary";
import type { JobSheetBody } from "@/capabilities/living-sheet/types";

function bannedWordRegex(phrase: string): RegExp {
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function body(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "Front wheel bearing service",
    machineLabel: "Bike-Stand-7",
    component: "Front hub",
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [],
    author: null,
    notes: null,
    ...over,
  };
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

/**
 * R2-13 — property: EVERY procedure section the template carries (item
 * source/annotation, step source/drawing ref, template notes — the same
 * gaps already fixed in print) must reach the reviewer on this screen, not
 * only the preview table. One fully-populated fixture + four separate
 * adversarial variants (one per field), same discipline as the print suite.
 */
describe("JobSheetsLibrary — RecipeReview (R2-13: no stored procedural content is silently dropped)", () => {
  const noop = () => {};

  it.each([
    {
      label: "an item's own source",
      over: { items: [{ id: "i1", kind: "part" as const, item: "Gasket", spec: null, qty: 1, source: "warehouse bin 12", notes: null }] },
      needle: "warehouse bin 12",
    },
    {
      label: "an item's own annotation",
      over: { items: [{ id: "i1", kind: "tool" as const, item: "Bracket", spec: null, qty: 1, source: null, notes: "Only if bent." }] },
      needle: "Only if bent.",
    },
    {
      label: "a step's source/drawing reference",
      over: { steps: [{ id: "s1", text: "Torque the flange bolts", checkoff: "torque" as const, torqueRef: null, source: "Drawing E-204 rev C" }] },
      needle: "Drawing E-204 rev C",
    },
    {
      label: "the template author's own notes",
      over: { notes: "Torque sequence must follow the star pattern." },
      needle: "Torque sequence must follow the star pattern.",
    },
  ])("$label reaches the review screen", ({ over, needle }) => {
    const html = renderToStaticMarkup(
      <RecipeReview body={body(over)} busy={false} onMarkReviewed={noop} onCancel={noop} testIdPrefix="t1" />,
    );
    expect(html).toContain(needle);
  });

  it("a fully-populated job sheet (every section at once) shows every stored piece of content", () => {
    const fullBody = body({
      isolationPoints: "Lock the main disconnect.",
      cautions: "Wheel is heavy; two-person lift.",
      returnToService: ["Jog motor, confirm no abnormal noise"],
      notes: "Torque sequence must follow the star pattern.",
      items: [{ id: "i1", kind: "part", item: "Gasket", spec: null, qty: 1, source: "warehouse bin 12", notes: "Only if bent." }],
      steps: [{ id: "s1", text: "Torque the flange bolts", checkoff: "torque", torqueRef: null, source: "Drawing E-204 rev C" }],
      torques: [{ id: "t1", what: "Wheel bolts", value: 85, unit: "ft-lb", pattern: "star", threadLocker: "blue 242", tool: "3/4 impact", source: "Manual p.12" }],
    });
    const html = renderToStaticMarkup(
      <RecipeReview body={fullBody} busy={false} onMarkReviewed={noop} onCancel={noop} testIdPrefix="t1" />,
    );
    for (const needle of [
      "Lock the main disconnect.",
      "Wheel is heavy; two-person lift.",
      "Jog motor, confirm no abnormal noise",
      "Torque sequence must follow the star pattern.",
      "warehouse bin 12",
      "Only if bent.",
      "Drawing E-204 rev C",
      "Manual p.12",
    ]) {
      expect(html).toContain(needle);
    }
  });

  it("an empty template says so for the new sections, never leaving them blank", () => {
    const html = renderToStaticMarkup(
      <RecipeReview body={body()} busy={false} onMarkReviewed={noop} onCancel={noop} testIdPrefix="t1" />,
    );
    expect(html).toContain("None written.");
  });
});
