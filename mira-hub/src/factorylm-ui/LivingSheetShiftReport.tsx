"use client";
/**
 * Shift report for the lead (TASK-S6 UI slice). A "Shift report" button on
 * the Living Work Sheet job list (LivingSheet.tsx) opens this layer:
 * needs-attention first, then every event by technician, handover notes,
 * and counts — last 12 hours by default. Printable the same way as the
 * job-sheet print view (LivingSheetPrint.tsx): the WorkPacketPanel print-
 * isolation TECHNIQUE, reimplemented independently with its own class
 * names, never imported from WorkPacketPanel or living-sheet-print.
 *
 * Backend (shift-report.ts's pure `shiftReport`, and the GET route) already
 * exists and is already banned-words-clean — this file is the UI only. The
 * UI's OWN static copy (headings, button labels) is separately checked by
 * this file's own test.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { ShiftReport } from "@/capabilities/living-sheet/shift-report";
import { apiGetShiftReport } from "./living-sheet-client";
import { PRINT_PORTAL_CLASS, PRINT_PORTAL_CSS, PrintPortal } from "./print-portal";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export type LivingSheetShiftReportProps = { onClose: () => void };

/** Pure: the default window the report opens with (last 12h ending now).
 *  Exported for testing and so a caller could offer a wider window later. */
export function defaultShiftWindow(nowIso: string): { from: string; to: string } {
  const to = nowIso;
  const from = new Date(Date.parse(nowIso) - TWELVE_HOURS_MS).toISOString();
  return { from, to };
}

const LAYER_STYLE: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 72, overflowY: "auto",
  background: "var(--fl-surface)", color: "var(--fl-text)", fontFamily: "var(--fl-font)",
  padding: "var(--fl-space-4, 16px)", fontSize: "17px", boxSizing: "border-box",
};
const SECTION_STYLE: CSSProperties = {
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", padding: "12px", marginBottom: 16,
};
const BUTTON_STYLE: CSSProperties = {
  minHeight: 48, padding: "10px 18px", marginInlineEnd: 8, marginTop: 8, borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-surface)",
  cursor: "pointer", fontSize: "17px",
};
const GHOST_BUTTON_STYLE: CSSProperties = { ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-text)" };

// Print-isolation technique copied from WorkPacketPanel.tsx (never imported):
// The print copy is portalled to <body> (see print-portal.tsx): every other
// body child is display:none in print, and the copy is display:none on screen.
const PRINT_CSS = `
@page {
  size: portrait;
  margin: 0.9in 0.6in 0.6in 0.6in;
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #000; }
}
@media print {
  .ls-shift-print-root { background: #fff; color: #000; font-size: 11pt; }
  .ls-shift-print-header {
    position: fixed; top: 0; left: 0; right: 0;
    background: #fff; color: #000; border-bottom: 1px solid #000; padding: 4px 0;
  }
  .ls-shift-print-body { margin-top: 40px; }
}
${PRINT_PORTAL_CSS}`;

/** Pure presentational body — no hooks, so it renders fully under
 *  renderToStaticMarkup for direct testing with a populated fixture. */
export function ShiftReportBody({ report }: { report: ShiftReport }) {
  if (report.emptyMessage) {
    return <p data-testid="shift-report-empty">{report.emptyMessage}</p>;
  }
  return (
    <>
      {report.needsAttention.length > 0 && (
        <section style={SECTION_STYLE} data-testid="shift-report-attention">
          <h3 style={{ marginTop: 0 }}>Needs attention</h3>
          {report.needsAttention.map((a, i) => (
            <p key={i}>
              {a.machineName} — {a.jobTitle}: {a.text}
              {a.by ? ` (${a.by})` : ""}
            </p>
          ))}
        </section>
      )}

      <section style={SECTION_STYLE} data-testid="shift-report-by-technician">
        <h3 style={{ marginTop: 0 }}>By technician</h3>
        {report.byTechnician.length === 0 && <p>No activity in this window.</p>}
        {report.byTechnician.map((group) => (
          <div key={group.technician} style={{ marginTop: 8 }}>
            <strong>{group.technician}</strong>
            {group.entries.map((e) => (
              <p key={e.eventId} style={{ marginInlineStart: 12 }}>
                {e.atLocal} — {e.machineName} ({e.jobTitle}): {e.text}
              </p>
            ))}
          </div>
        ))}
      </section>

      {report.handover.length > 0 && (
        <section style={SECTION_STYLE} data-testid="shift-report-handover">
          <h3 style={{ marginTop: 0 }}>Handover notes</h3>
          {report.handover.map((h, i) => (
            <p key={i}>
              {h.machineName} ({h.jobTitle}): {h.text}
            </p>
          ))}
        </section>
      )}

      <section style={SECTION_STYLE} data-testid="shift-report-counts">
        <h3 style={{ marginTop: 0 }}>Counts</h3>
        <p>
          Jobs touched: {report.counts.jobsTouched} · Finished: {report.counts.jobsFinished} · Still open:{" "}
          {report.counts.jobsOpen}
        </p>
      </section>
    </>
  );
}

export function LivingSheetShiftReport({ onClose }: LivingSheetShiftReportProps) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportWindow] = useState(() => defaultShiftWindow(new Date().toISOString()));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetShiftReport(reportWindow);
      if (!res.ok) {
        setError(res.body.message ?? "The shift report could not be loaded.");
        return;
      }
      setReport(res.body.report ?? null);
    } catch {
      setError("No reply from the server.");
    } finally {
      setLoading(false);
    }
  }, [reportWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section role="dialog" aria-label="Shift report" style={LAYER_STYLE} data-testid="shift-report-layer">
      <style>{PRINT_CSS}</style>
      <div>
        <header
          data-no-print
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
        >
          <h2 style={{ fontSize: "20px", margin: 0 }}>Shift report</h2>
          <div>
            <button type="button" style={GHOST_BUTTON_STYLE} onClick={() => window.print()} data-testid="shift-report-print">
              Print / save PDF
            </button>
            <button type="button" style={GHOST_BUTTON_STYLE} onClick={onClose} data-testid="shift-report-close">
              Close
            </button>
          </div>
        </header>

        {loading && <p>Loading…</p>}
        {error && <p role="alert">{error}</p>}
        {report && <ShiftReportBody report={report} />}
      </div>
      <PrintPortal>
        <div className={`ls-shift-print-root ${PRINT_PORTAL_CLASS}`} data-testid="shift-report-print-root">
          <div className="ls-shift-print-header" data-testid="shift-report-print-header">
            Shift report · {new Date(reportWindow.from).toLocaleString()} – {new Date(reportWindow.to).toLocaleString()}
          </div>
          <div className="ls-shift-print-body">{report && <ShiftReportBody report={report} />}</div>
        </div>
      </PrintPortal>
    </section>
  );
}
