"use client";
/**
 * Job sheets library (TASK-S4 UI slice): find a reusable job sheet
 * template, import Mike's spreadsheet with a preview-before-save step, and
 * mark a draft reviewed. Reached from the Living Work Sheet job list via
 * the "Job sheets" button (LivingSheet.tsx). Backend (job-sheet-store.ts,
 * job-sheet-import.ts, the /api/job-sheets/** routes) and the pure
 * search/badge/preview helpers (job-sheet-library-logic.ts, already fully
 * tested) already exist — this file is the UI only.
 *
 * The manual "Add a job" form is intentionally skipped (task's own call:
 * "skip the Add a job manual form if it gets long — import is the
 * priority"). Mike's spreadsheets are the real source; a hand-typed form
 * would duplicate the importer's field set for no gain yet.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { JobSheetSummary } from "./living-sheet-client";
import type { ImportPreview } from "@/capabilities/living-sheet/job-sheet-import";
import {
  apiCreateJobSheet,
  apiListJobSheetTemplates,
  apiPreviewJobSheetImport,
  apiReviewJobSheet,
  chosenRevisionOf,
} from "./living-sheet-client";
import { draftBadge, previewRows, searchJobSheets, type PreviewRow } from "./job-sheet-library-logic";

const IMPORT_HELP =
  'Paste Mike’s spreadsheet as tab-separated text (copy cells straight from Google Sheets or Excel). For the 5-tab layout, put a line "### <Tab name>" before each of the Jobs, Tools & parts, Torque & settings, and Steps tabs. A single Gemini job-card tab pastes as-is.';

const SECTION_STYLE: CSSProperties = {
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", padding: "12px",
  marginBottom: 16, background: "var(--fl-surface)",
};
const FIELD_STYLE: CSSProperties = {
  display: "block", width: "100%", minHeight: 48, marginTop: 6, padding: "10px",
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", background: "var(--fl-surface)",
  color: "var(--fl-text)", fontSize: "17px", boxSizing: "border-box",
};
const BUTTON_STYLE: CSSProperties = {
  minHeight: 48, padding: "10px 18px", marginInlineEnd: 8, marginTop: 8, borderRadius: "var(--fl-radius)",
  border: "1px solid var(--fl-line)", background: "var(--fl-accent)", color: "var(--fl-surface)",
  cursor: "pointer", fontSize: "17px",
};
const GHOST_BUTTON_STYLE: CSSProperties = { ...BUTTON_STYLE, background: "var(--fl-surface)", color: "var(--fl-text)" };
const BADGE_STYLE: CSSProperties = {
  display: "inline-block", padding: "2px 8px", borderRadius: "var(--fl-radius)", fontSize: "15px",
  border: "1px solid var(--fl-line)", color: "var(--fl-muted)", marginInlineStart: 8,
};
const LAYER_STYLE: CSSProperties = {
  border: "1px solid var(--fl-line)", borderRadius: "var(--fl-radius)", padding: "16px",
  marginBottom: 16, background: "var(--fl-surface)", color: "var(--fl-text)", fontSize: "17px",
};

export type JobSheetsLibraryProps = {
  onClose: () => void;
  /** Test-only escape hatch: renderToStaticMarkup never runs the click
   *  handler that would switch tabs, so a red-first test for the import
   *  tab's static copy needs a way to render it directly. */
  initialMode?: "browse" | "import";
};

export function JobSheetsLibrary({ onClose, initialMode = "browse" }: JobSheetsLibraryProps) {
  const [sheets, setSheets] = useState<JobSheetSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"browse" | "import">(initialMode);

  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // One clientRequestId per previewed job, minted once when the preview
  // arrives and reused across every "Save as draft" click (including a
  // retry after a partial failure) — this IS what makes the server's
  // idempotency do anything. Minting a fresh id per click would turn a
  // retry into a duplicate job sheet.
  const [saveRequestIds, setSaveRequestIds] = useState<string[]>([]);
  const [saveResults, setSaveResults] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  // Same idea for "Mark reviewed": one id per job sheet, reused on retry.
  const [reviewRequestIds, setReviewRequestIds] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const list = await apiListJobSheetTemplates();
    if (list === null) {
      setLoadError("Job sheets could not be loaded.");
      return;
    }
    setSheets(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = sheets ? searchJobSheets(sheets, query) : [];

  const onPreview = useCallback(async () => {
    const text = pasteText.trim();
    if (!text) return;
    setPreviewBusy(true);
    setPreviewError(null);
    setPreview(null);
    setSaveResults({});
    try {
      const res = await apiPreviewJobSheetImport(text);
      if (!res.ok) {
        setPreviewError(res.body.message ?? "That text could not be read. Check the format and try again.");
        return;
      }
      setPreview(res.body);
      setSaveRequestIds(res.body.jobs.map(() => crypto.randomUUID()));
    } catch {
      setPreviewError("No reply from the server. Try again.");
    } finally {
      setPreviewBusy(false);
    }
  }, [pasteText]);

  const onSaveAsDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setActionError(null);
    const results: Record<number, string> = {};
    for (let i = 0; i < preview.jobs.length; i++) {
      const job = preview.jobs[i]!;
      const requestId = saveRequestIds[i] ?? crypto.randomUUID();
      try {
        const res = await apiCreateJobSheet(job.body, requestId);
        results[i] = res.ok
          ? "Saved as draft."
          : res.body.message ?? `Could not save${res.body.field ? ` — check ${res.body.field}` : ""}.`;
      } catch {
        results[i] = "No reply from the server.";
      }
    }
    setSaveResults(results);
    setSaving(false);
    await load();
  }, [preview, saveRequestIds, load]);

  const onMarkReviewed = useCallback(
    async (sheet: JobSheetSummary) => {
      setReviewBusy(sheet.jobSheetId);
      setActionError(null);
      // Reuse the same clientRequestId across retries for this sheet, minted
      // once on first attempt — same idempotency reasoning as saveRequestIds.
      const requestId = reviewRequestIds[sheet.jobSheetId] ?? crypto.randomUUID();
      setReviewRequestIds((prev) => ({ ...prev, [sheet.jobSheetId]: requestId }));
      try {
        const res = await apiReviewJobSheet(sheet.jobSheetId, sheet.latest.revision, requestId);
        if (!res.ok) {
          setActionError(res.body.message ?? "Could not mark this job sheet reviewed.");
          return;
        }
        await load();
      } catch {
        setActionError("No reply from the server.");
      } finally {
        setReviewBusy(null);
      }
    },
    [reviewRequestIds, load],
  );

  return (
    <section style={LAYER_STYLE} data-testid="job-sheets-library">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Job sheets</h3>
        <button type="button" style={GHOST_BUTTON_STYLE} onClick={onClose} data-testid="job-sheets-library-close">
          Close
        </button>
      </header>

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          style={mode === "browse" ? BUTTON_STYLE : GHOST_BUTTON_STYLE}
          onClick={() => setMode("browse")}
          data-testid="job-sheets-library-browse-tab"
        >
          Find a job
        </button>
        <button
          type="button"
          style={mode === "import" ? BUTTON_STYLE : GHOST_BUTTON_STYLE}
          onClick={() => setMode("import")}
          data-testid="job-sheets-library-import-tab"
        >
          Import
        </button>
      </div>

      {actionError && <p role="alert">{actionError}</p>}

      {mode === "browse" && (
        <div data-testid="job-sheets-library-browse">
          {loadError && <p role="alert">{loadError}</p>}
          <label>
            Search by title, machine, or component
            <input
              style={FIELD_STYLE}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="job-sheets-library-search"
            />
          </label>
          <ul style={{ listStyle: "none", paddingInlineStart: 0 }}>
            {filtered.map((sheet) => {
              const { revision, isDraft } = chosenRevisionOf(sheet);
              const badge = draftBadge(revision.status);
              return (
                <li
                  key={sheet.jobSheetId}
                  style={{ borderTop: "1px solid var(--fl-line)", padding: "10px 0" }}
                  data-testid={`job-sheets-library-item-${sheet.jobSheetId}`}
                >
                  <strong>{revision.body.title || "(untitled)"}</strong>
                  {badge && (
                    <span style={BADGE_STYLE} data-testid={`job-sheets-library-draft-${sheet.jobSheetId}`}>
                      {badge}
                    </span>
                  )}
                  <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                    {revision.body.machineLabel ?? "any machine"}
                    {revision.body.component ? ` · ${revision.body.component}` : ""}
                  </div>
                  {revision.reviewedBy ? (
                    <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>
                      Reviewed by {revision.reviewedBy}, {new Date(revision.reviewedAt ?? revision.createdAt).toLocaleDateString()}
                    </div>
                  ) : (
                    isDraft && (
                      <button
                        type="button"
                        style={GHOST_BUTTON_STYLE}
                        disabled={reviewBusy === sheet.jobSheetId}
                        onClick={() => void onMarkReviewed(sheet)}
                        data-testid={`job-sheets-library-review-${sheet.jobSheetId}`}
                      >
                        {reviewBusy === sheet.jobSheetId ? "Marking reviewed…" : "Mark reviewed"}
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {sheets !== null && filtered.length === 0 && <p>No job sheets match.</p>}
        </div>
      )}

      {mode === "import" && (
        <div data-testid="job-sheets-library-import">
          <p style={{ fontSize: "15px", color: "var(--fl-muted)" }}>{IMPORT_HELP}</p>
          <textarea
            style={{ ...FIELD_STYLE, minHeight: 160, fontFamily: "monospace" }}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            data-testid="job-sheets-library-paste"
          />
          {previewError && <p role="alert">{previewError}</p>}
          <button
            type="button"
            style={BUTTON_STYLE}
            disabled={!pasteText.trim() || previewBusy}
            onClick={onPreview}
            data-testid="job-sheets-library-preview"
          >
            {previewBusy ? "Reading…" : "Preview"}
          </button>

          {preview && (
            <div data-testid="job-sheets-library-preview-result">
              <PreviewTable preview={preview} />
              {preview.jobs.length > 0 && (
                <button
                  type="button"
                  style={BUTTON_STYLE}
                  disabled={saving || Object.keys(saveResults).length > 0}
                  onClick={onSaveAsDraft}
                  data-testid="job-sheets-library-save-draft"
                >
                  {saving ? "Saving…" : "Save as draft"}
                </button>
              )}
              {Object.entries(saveResults).map(([i, msg]) => (
                <p key={i} data-testid={`job-sheets-library-save-result-${i}`}>
                  {preview.jobs[Number(i)]?.body.title || "(untitled)"}: {msg}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PreviewTable({ preview }: { preview: ImportPreview }) {
  const rows: PreviewRow[] = previewRows(preview);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }} data-testid="job-sheets-library-preview-table">
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Title</th>
          <th style={{ textAlign: "left" }}>Status</th>
          <th style={{ textAlign: "left" }}>Details</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--fl-line)" }}>
            <td>{r.title}</td>
            <td>{r.status === "refused" ? "Refused" : r.status === "warning" ? "Warning" : "OK"}</td>
            <td>{r.status === "refused" ? r.reason : r.warnings.length > 0 ? r.warnings.join("; ") : "No warnings."}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
