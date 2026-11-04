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

  it("F04: shows the ad-hoc banner (not the DRAFT banner) when templateStatus is null, and shows neither when reviewed", () => {
    const adHocHtml = renderToStaticMarkup(<LivingSheetPrint view={baseView({ templateStatus: null })} {...OPTS} />);
    expect(adHocHtml).toContain("Not from a reviewed job sheet");
    expect(adHocHtml).not.toContain("DRAFT job sheet");
    const reviewedHtml = renderToStaticMarkup(<LivingSheetPrint view={baseView({ templateStatus: "reviewed" })} {...OPTS} />);
    expect(reviewedHtml).not.toContain("Not from a reviewed job sheet");
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
    expect(html).toContain("table-header-group");
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

describe("LivingSheetPrint — layout + handover (found by the §12 PDF inspection)", () => {
  it("prints the current handover once, and only earlier handovers struck through", () => {
    const h1 = { text: "First handover note TEST", by: "A", at: "2026-11-03T20:00:00.000Z", eventId: "e1" };
    const h2 = { text: "Latest handover note TEST", by: "A", at: "2026-11-03T21:00:00.000Z", eventId: "e2" };
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView({ handover: { current: h2, history: [h1, h2] } })} {...OPTS} />);
    expect(html.split("Latest handover note TEST").length - 1).toBe(1);
    expect(html.split("First handover note TEST").length - 1).toBe(1);
  });
  it("isolates the print copy at page level (display:none on every other body child), not visibility", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toContain("body > *:not(.fl-print-portal)");
    expect(html).not.toMatch(/body \* \{ visibility: hidden/);
    expect(html).toContain("fl-print-portal");
  });
  it("repeats the running header through a table head, not a fixed box that covers the body", () => {
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView()} {...OPTS} />);
    expect(html).toMatch(/<thead[^>]*>[\s\S]*living-sheet-print-header/);
    expect(html).not.toMatch(/\.ls-print-header\s*\{[^}]*position:\s*fixed/);
  });
  it("ticks the box for a done step and leaves it empty for an open one", () => {
    const step = { text: "", checkoff: "none" as const, torqueRef: null, source: null, note: null, history: [] };
    const view = baseView({
      steps: [
        { ...step, id: "s1", text: "Remove guard TEST", done: true, doneBy: "A", doneAt: "2026-11-03T20:00:00.000Z" },
        { ...step, id: "s2", text: "Torque bolts TEST", done: false, doneBy: null, doneAt: null },
      ],
    });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    expect(html).toMatch(/☑<\/span>(<!-- -->)?Remove guard TEST/);
    expect(html).toMatch(/☐<\/span>(<!-- -->)?Torque bolts TEST/);
  });
});

describe("LivingSheetPrint — F13: procedural template content execution/export was omitting", () => {
  it("renders cautions, return-to-service checks, template notes, torque pattern/tool/thread-locker, and a bring-list item's source", () => {
    const view = baseView({
      template: {
        ...baseView().template,
        cautions: "Wheel is heavy; two-person lift",
        returnToService: ["Jog motor, confirm no abnormal noise"],
        notes: "Torque sequence must follow the star pattern.",
        items: [{ id: "i1", kind: "part", item: "Gasket", spec: null, qty: 1, source: "warehouse bin 12", notes: null }],
        torques: [
          { id: "t1", what: "Wheel bolts", value: 85, unit: "ft-lb", pattern: "star", threadLocker: "blue 242", tool: "3/4 impact", source: "Manual p.12" },
        ],
      },
    });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    expect(html).toContain("Wheel is heavy; two-person lift");
    expect(html).toContain("Jog motor, confirm no abnormal noise");
    expect(html).toContain("Torque sequence must follow the star pattern.");
    expect(html).toContain("star");
    expect(html).toContain("blue 242");
    expect(html).toContain("3/4 impact");
    expect(html).toContain("warehouse bin 12");
  });
});

describe("LivingSheetPrint — F14: reading provenance (who/when, and struck values stay visible with their own who/when)", () => {
  it("prints the current value with who and when, plus the source when the event carries one", () => {
    const view = baseView({
      readings: [
        {
          id: "r1",
          what: "Motor current",
          current: { value: 4.8, unit: "A", by: "Mike", at: "2026-11-03T21:14:00.000Z", eventId: "e2" },
          history: [
            { value: 48, unit: "A", by: "Tech One", at: "2026-11-03T20:00:00.000Z", eventId: "e1", superseded: true },
            { value: 4.8, unit: "A", by: "Mike", at: "2026-11-03T21:14:00.000Z", eventId: "e2", superseded: false },
          ],
          source: { kind: "tech", ref: null },
        },
      ],
    });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    // Current value, attributed.
    expect(html).toContain("4.8");
    expect(html).toContain("Mike");
    // Struck earlier value stays visible, attributed to its OWN who/when
    // (not the current value's) — the correction is never hidden.
    expect(html).toContain("48");
    expect(html).toContain("Tech One");
    expect(html).toMatch(/48 A.*Tech One/);
  });

  it("still prints who/when for a reading with no event-carried source", () => {
    const view = baseView({
      readings: [
        {
          id: "r1",
          what: "Discharge pressure",
          current: { value: 20, unit: "psi", by: "A", at: "2026-11-03T14:00:00.000Z", eventId: "e1" },
          history: [{ value: 20, unit: "psi", by: "A", at: "2026-11-03T14:00:00.000Z", eventId: "e1", superseded: false }],
          source: null,
        },
      ],
    });
    const html = renderToStaticMarkup(<LivingSheetPrint view={view} {...OPTS} />);
    expect(html).toContain("20");
    expect(html).toContain("A");
  });
});

describe("LivingSheetPrint — F05: handover is quoted verbatim and attributed, never altered", () => {
  it("prints the technician's own words quoted and attributed, even when they use a word MIRA's own wording never would", () => {
    const current = { text: "Pump is fixed", by: "Mike", at: "2026-11-03T18:00:00.000Z", eventId: "e1" };
    const html = renderToStaticMarkup(<LivingSheetPrint view={baseView({ handover: { current, history: [current] } })} {...OPTS} />);
    // Quoted, not stripped or paraphrased.
    expect(html).toContain("Pump is fixed");
    // Attributed: who and when.
    expect(html).toContain("Mike");
    expect(html).toMatch(/Pump is fixed[\s\S]*Mike/);
  });
});
