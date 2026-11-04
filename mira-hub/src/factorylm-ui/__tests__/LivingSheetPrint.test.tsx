/**
 * Red-first tests for LivingSheetPrint.tsx (TASK-S5 UI slice). Same
 * no-jsdom constraint as LivingSheet.test.tsx: `renderToStaticMarkup` only,
 * no effects. This component is pure props -> JSX (printModel is already
 * pure and fully tested in living-sheet-print.test.ts), so a full static
 * render is a legitimate, deterministic assertion surface — not just a
 * loading-state smoke test.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingSheetPrint } from "../LivingSheetPrint";
import type { SheetView } from "@/capabilities/living-sheet/reduce";

function baseView(over: Partial<SheetView> = {}): SheetView {
  return {
    jobId: "11111111-2222-3333-4444-555555555555",
    seq: 3,
    title: "Belt swap",
    machine: { entityId: "e-1", name: "Conveyor 3" },
    templateRevisionId: null,
    templateStatus: null,
    template: {
      title: "Belt swap", machineLabel: null, component: null, jobType: null, estHours: null,
      crewSize: null, isolationPoints: null, cautions: null, returnToService: [],
      items: [], torques: [], steps: [], author: null, notes: null,
    },
    steps: [], readings: [], parts: [], notes: [], questions: [], photos: [],
    handover: { current: null, history: [] },
    finished: null,
    openSteps: 0,
    openQuestions: 0,
    warnings: [],
    ...over,
  };
}

const OPTS = { printedAt: "2026-11-03 10:00", seq: 3 };

function bannedWordRegex(phrase: string): RegExp {
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** The banned-words check scans visible UI copy, not the embedded print CSS
 *  — "position: fixed" is a required technique (this task's own spec), not
 *  user-visible text, and must not trip the "fixed" ban. */
function visibleTextOf(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "");
}

describe("LivingSheetPrint — header + static content", () => {
  it("renders the running header with job id, title, machine, change #, and printed time", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toContain("11111111");
    expect(html).toContain("Belt swap");
    expect(html).toContain("Conveyor 3");
    expect(html).toContain("Snapshot at change #3");
    expect(html).toContain("Printed 2026-11-03 10:00");
  });

  it("shows the DRAFT banner only when templateStatus is draft", () => {
    const draftHtml = renderToStaticMarkup(<LivingSheetPrint view={baseView({ templateStatus: "draft" })} {...OPTS} />);
    expect(draftHtml).toContain("DRAFT job sheet");
    const reviewedHtml = renderToStaticMarkup(<LivingSheetPrint view={baseView({ templateStatus: "reviewed" })} {...OPTS} />);
    expect(reviewedHtml).not.toContain("DRAFT job sheet");
  });

  it("falls back to the lockout-procedure line when isolationPoints is null", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toContain("follow your site");
  });

  it("marks an unsourced torque value as unverified, verbatim", () => {
    const view = baseView({
      template: {
        ...baseView().template,
        torques: [{ id: "t1", what: "Head bolt", value: 85, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: null }],
      },
    });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    expect(html).toContain("no source");
    expect(html).toContain("unverified");
  });

  it("includes the footer disclaimer and both signature lines", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toContain("does not authorize return to service");
    expect(html).toContain("Technician");
    expect(html).toContain("Supervisor");
  });

  it("renders a photo's src from fileUrl(fileId), not a placeholder", () => {
    const view = baseView({ photos: [{ id: "p1", fileId: "file-abc", caption: "worn pad", by: "Mike", at: "2026-11-03T10:00:00Z", eventId: "ev1" }] });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    expect(html).toContain("file-abc");
    expect(html).toContain("worn pad");
  });

  it("ships print CSS with a running header, @page page-count box, and a screen-hidden root", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toContain("@media print");
    expect(html).toContain("position: fixed");
    expect(html).toMatch(/counter\(page\)/);
    expect(html).toMatch(/counter\(pages\)/);
    expect(html).toContain("@media screen");
  });
});

describe("LivingSheetPrint — banned words", () => {
  // Same phrase list and rationale as living-sheet-print.test.ts: "fixed"
  // bare, but "safe"/"repaired" only as the exact offending phrases — a
  // bare "safe" would false-positive on this component's own "Safety"
  // section heading.
  const BANNED = ["fixed", "safe to run", "safe to operate", "repaired successfully"];

  it("control: the regex actually fires on violating text (proves the check isn't vacuous)", () => {
    for (const phrase of BANNED) {
      expect(bannedWordRegex(phrase).test(`This machine is now ${phrase}.`)).toBe(true);
    }
  });

  it("never renders a banned word across a fully populated sheet", () => {
    const view = baseView({
      templateStatus: "draft",
      template: {
        ...baseView().template,
        isolationPoints: "Lock the main disconnect.",
        items: [{ id: "i1", kind: "tool", item: "Torque wrench", spec: null, qty: 1, source: null, notes: null }],
        torques: [{ id: "t1", what: "Head bolt", value: 85, unit: "ft-lb", pattern: null, threadLocker: null, tool: null, source: "manual p.12" }],
      },
      steps: [{ id: "s1", text: "Replace belt", checkoff: "none", torqueRef: null, source: null, done: true, doneBy: "Mike", doneAt: "2026-11-03T10:00:00Z", note: null, history: [] }],
      readings: [{ id: "r1", what: "Motor current", current: { value: 4.8, unit: "A", by: "Mike", at: "2026-11-03T10:00:00Z", eventId: "ev1" }, history: [], source: null }],
      notes: [{ id: "n1", text: "Checked alignment", by: "Mike", at: "2026-11-03T10:00:00Z", eventId: "ev2" }],
      questions: [{ id: "q1", text: "Is spare in stock?", by: "Mike", at: "2026-11-03T10:00:00Z", eventId: "ev3", resolved: true, resolution: "Yes, confirmed with stores.", resolvedBy: "Mike", resolvedAt: "2026-11-03T11:00:00Z" }],
      parts: [{ id: "p1", item: "Belt", action: "used", qty: 1, by: "Mike", at: "2026-11-03T10:00:00Z", eventId: "ev4" }],
      handover: { current: { text: "Watch for slip next shift", by: "Mike", at: "2026-11-03T12:00:00Z", eventId: "ev5" }, history: [] },
    });
    const html = visibleTextOf(renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />));
    for (const phrase of BANNED) {
      expect(bannedWordRegex(phrase).test(html)).toBe(false);
    }
  });
});
