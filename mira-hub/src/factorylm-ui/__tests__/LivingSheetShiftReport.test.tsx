/**
 * Red-first tests for LivingSheetShiftReport.tsx (TASK-S6 UI slice). Same
 * no-jsdom pattern as LivingSheet.test.tsx: pure helpers get plain unit
 * tests; the stateful component gets only the static, no-effects-run SSR
 * shape (its data fetch lives in a useEffect, which renderToStaticMarkup
 * never runs).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingSheetShiftReport, ShiftReportBody, defaultShiftWindow } from "../LivingSheetShiftReport";
import type { ShiftReport } from "@/capabilities/living-sheet/shift-report";

function bannedWordRegex(phrase: string): RegExp {
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

describe("defaultShiftWindow", () => {
  it("defaults to exactly the last 12 hours ending at the given instant", () => {
    const now = "2026-11-03T22:00:00.000Z";
    const w = defaultShiftWindow(now);
    expect(w.to).toBe(now);
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(12 * 60 * 60 * 1000);
  });
});

function baseReport(over: Partial<ShiftReport> = {}): ShiftReport {
  return {
    window: { from: "2026-11-03T10:00:00.000Z", to: "2026-11-03T22:00:00.000Z" },
    needsAttention: [],
    byTechnician: [],
    handover: [],
    counts: { jobsTouched: 0, jobsFinished: 0, jobsOpen: 0 },
    emptyMessage: null,
    plainText: "",
    ...over,
  };
}

describe("ShiftReportBody", () => {
  it("shows needs-attention first, then by-technician, handover, and counts", () => {
    const report = baseReport({
      needsAttention: [
        { notebookId: "nb1", notebookName: "Line 1", jobId: "j1", jobTitle: "Belt swap", machineName: "Conveyor 3", reason: "open_steps", text: "2 steps still open", by: null, at: null },
      ],
      byTechnician: [
        { technician: "Mike", entries: [{ notebookId: "nb1", notebookName: "Line 1", jobId: "j1", jobTitle: "Belt swap", machineName: "Conveyor 3", eventId: "ev1", kind: "note_added", at: "2026-11-03T11:00:00.000Z", atLocal: "11:00", by: "Mike", text: "noted: checked alignment" }] },
      ],
      handover: [
        { notebookId: "nb1", notebookName: "Line 1", jobId: "j1", jobTitle: "Belt swap", machineName: "Conveyor 3", text: "watch for slip", by: "Mike", at: "2026-11-03T12:00:00.000Z" },
      ],
      counts: { jobsTouched: 3, jobsFinished: 1, jobsOpen: 2 },
    });
    const html = renderToStaticMarkup(<ShiftReportBody report={report} />);
    expect(html).toContain("2 steps still open");
    expect(html).toContain("Mike");
    expect(html).toContain("checked alignment");
    expect(html).toContain("watch for slip");
    expect(html).toContain("3");
    expect(html).toContain("1");
    expect(html).toContain("2");
  });

  it("shows the empty message when no job had any event in the window", () => {
    const report = baseReport({ emptyMessage: "No activity in this window." });
    const html = renderToStaticMarkup(<ShiftReportBody report={report} />);
    expect(html).toContain("No activity in this window.");
  });

  it("never renders a banned word in its own static copy", () => {
    const report = baseReport({
      needsAttention: [{ notebookId: "nb1", notebookName: "Line 1", jobId: "j1", jobTitle: "Belt swap", machineName: "Conveyor 3", reason: "correction", text: "corrected motor current 48 A → 4.8 A at 21:14", by: "Mike", at: "2026-11-03T21:14:00.000Z" }],
      handover: [{ notebookId: "nb1", notebookName: "Line 1", jobId: "j1", jobTitle: "Belt swap", machineName: "Conveyor 3", text: "finished (reported by Mike)", by: "Mike", at: "2026-11-03T12:00:00.000Z" }],
    });
    const html = renderToStaticMarkup(<ShiftReportBody report={report} />);
    for (const phrase of ["fixed", "safe", "repaired", "resolved"]) {
      expect(bannedWordRegex(phrase).test(html)).toBe(false);
    }
  });
});

describe("LivingSheetShiftReport (SSR shape)", () => {
  it("renders the header, print and close controls before the fetch resolves (no effects run under SSR)", () => {
    const html = renderToStaticMarkup(<LivingSheetShiftReport onClose={() => {}} />);
    expect(html).toContain("Shift report");
    expect(html).toContain("Print / save PDF");
    expect(html).toContain("Close");
  });
});

describe("LivingSheetShiftReport — print layout (found by the §12 PDF inspection)", () => {
  it("prints a page-level copy (display:none on every other body child), not a visibility mask over the narrow screen panel", () => {
    const html = renderToStaticMarkup(<LivingSheetShiftReport onClose={() => {}} />);
    expect(html).toContain("body > *:not(.fl-print-portal)");
    expect(html).not.toMatch(/body \* \{ visibility: hidden/);
  });
});

describe("LivingSheetShiftReport — repeating header", () => {
  it("repeats the header through a table head, not a fixed box that covers the body", () => {
    const html = renderToStaticMarkup(<LivingSheetShiftReport onClose={() => {}} />);
    expect(html).toMatch(/<thead[^>]*>[\s\S]*shift-report-print-header/);
    expect(html).not.toMatch(/\.ls-shift-print-header\s*\{[^}]*position:\s*fixed/);
  });
});

