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
import {
  allRowsSaved,
  draftBadge,
  indicesToRetry,
  previewRows,
  searchJobSheets,
  shouldReuseSaveIds,
  torqueDisplayRows,
  type PreviewRow,
} from "./job-sheet-library-logic";
import type { JobSheetBody } from "@/capabilities/living-sheet/types";

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
  // R2-21: tracked separately from `saveResults` (a human-readable message)
  // so "did THIS row actually succeed" is never inferred from matching a
  // message string. A row only ever flips false -> true, never back.
  const [saveSuccess, setSaveSuccess] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  // R2-21: the exact pasted text the current saveRequestIds/saveResults
  // belong to — lets a re-click of "Preview" on the SAME text reuse them
  // instead of minting fresh ids for a save that may have already landed.
  const [lastPreviewedText, setLastPreviewedText] = useState<string | null>(null);
  // Same idea for "Mark reviewed": one id per job sheet, reused on retry.
  const [reviewRequestIds, setReviewRequestIds] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // F12: "Mark reviewed" lives on the recipe-review screen, not the bare
  // list row — this tracks which sheet's recipe is currently open for review.
  const [reviewingId, setReviewingId] = useState<string | null>(null);

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
    try {
      const res = await apiPreviewJobSheetImport(text);
      if (!res.ok) {
        setPreviewError(res.body.message ?? "That text could not be read. Check the format and try again.");
        return;
      }
      setPreview(res.body);
      // R2-21: re-previewing the SAME pasted text (e.g. to recover after a
      // lost save response) must reuse the existing per-job request ids
      // and keep the results/successes already recorded — minting fresh
      // ids here would let a retry create a second job sheet for a save
      // that actually succeeded server-side. A genuinely different paste
      // starts clean.
      if (!shouldReuseSaveIds(lastPreviewedText, text, saveRequestIds.length, res.body.jobs.length)) {
        setSaveRequestIds(res.body.jobs.map(() => crypto.randomUUID()));
        setSaveResults({});
        setSaveSuccess({});
      }
      setLastPreviewedText(text);
    } catch {
      setPreviewError("No reply from the server. Try again.");
    } finally {
      setPreviewBusy(false);
    }
  }, [pasteText, lastPreviewedText, saveRequestIds.length]);

  const onSaveAsDraft = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setActionError(null);
    const results: Record<number, string> = { ...saveResults };
    const successes: Record<number, boolean> = { ...saveSuccess };
    // R2-21: only rows that have NOT already succeeded retry — a succeeded
    // row never resubmits, and a failed (or never-attempted) row retries
    // with its SAME clientRequestId (saveRequestIds is untouched here).
    for (const i of indicesToRetry(preview.jobs.length, saveSuccess)) {
      const job = preview.jobs[i]!;
      const requestId = saveRequestIds[i] ?? crypto.randomUUID();
      try {
        const res = await apiCreateJobSheet(job.body, requestId);
        results[i] = res.ok
          ? "Saved as draft."
          : res.body.message ?? `Could not save${res.body.field ? ` — check ${res.body.field}` : ""}.`;
        successes[i] = res.ok;
      } catch {
        results[i] = "No reply from the server.";
        successes[i] = false;
      }
    }
    setSaveResults(results);
    setSaveSuccess(successes);
    setSaving(false);
    await load();
  }, [preview, saveRequestIds, saveResults, saveSuccess, load]);

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
        setReviewingId(null);
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
                    isDraft &&
                    (reviewingId === sheet.jobSheetId ? (
                      <RecipeReview
                        body={revision.body}
                        busy={reviewBusy === sheet.jobSheetId}
                        onMarkReviewed={() => void onMarkReviewed(sheet)}
                        onCancel={() => setReviewingId(null)}
                        testIdPrefix={sheet.jobSheetId}
                      />
                    ) : (
                      // F12: this opens the parsed recipe FIRST — safety,
                      // bring list, steps, torques (value + source), checks
                      // — "Mark reviewed" lives on that screen, not here, so
                      // a review can't be recorded without seeing the recipe.
                      <button
                        type="button"
                        style={GHOST_BUTTON_STYLE}
                        onClick={() => setReviewingId(sheet.jobSheetId)}
                        data-testid={`job-sheets-library-review-${sheet.jobSheetId}`}
                      >
                        Review
                      </button>
                    ))
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
                  // R2-21: disable only once EVERY row has succeeded — a
                  // failed row (or one never attempted) keeps this
                  // actionable so it can be retried with its same id.
                  disabled={saving || allRowsSaved(preview.jobs.length, saveSuccess)}
                  onClick={onSaveAsDraft}
                  data-testid="job-sheets-library-save-draft"
                >
                  {saving ? "Saving…" : allRowsSaved(preview.jobs.length, saveSuccess) ? "Saved" : "Save as draft"}
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

/** F12: the parsed recipe a reviewer must see before Mark reviewed — safety,
 *  bring list, steps, torques (value + source), checks. No section is
 *  silently skipped: an empty one says so, it never just disappears.
 *  R2-13: also item source/annotation, step source/drawing ref, and the
 *  template author's own notes — the same gaps `living-sheet-print.ts`'s
 *  F13 fix closed for print. Exported (test-only, same pattern as
 *  JobSheetsLibrary's `initialMode`): reaching this screen normally needs
 *  a click `renderToStaticMarkup` never runs. */
export function RecipeReview({
  body,
  busy,
  onMarkReviewed,
  onCancel,
  testIdPrefix,
}: {
  body: JobSheetBody;
  busy: boolean;
  onMarkReviewed: () => void;
  onCancel: () => void;
  testIdPrefix: string;
}) {
  const torqueRows = torqueDisplayRows(body.torques);
  return (
    <div style={{ ...LAYER_STYLE, marginTop: 8 }} data-testid={`job-sheets-library-recipe-${testIdPrefix}`}>
      <h4 style={{ marginTop: 0 }}>Safety</h4>
      <p>{body.isolationPoints || "Not written — follow your site's lockout procedure."}</p>
      {body.cautions && <p>{body.cautions}</p>}

      <h4>Bring to the job</h4>
      {body.items.length > 0 ? (
        <ul>
          {body.items.map((it) => (
            <li key={it.id}>
              {it.item}{it.spec ? ` — ${it.spec}` : ""}{it.qty ? ` x${it.qty}` : ""}
              {/* R2-13: an item's source and its own annotation ("Only if
                 bent.") must reach the reviewer, not just the preview table. */}
              {it.source && <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>Source: {it.source}</div>}
              {it.notes && <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>{it.notes}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nothing listed.</p>
      )}

      <h4>Steps</h4>
      {body.steps.length > 0 ? (
        <ul>
          {body.steps.map((s) => (
            <li key={s.id}>
              {s.text}
              {s.checkoff !== "none" && <span style={{ color: "var(--fl-muted)" }}> ({s.checkoff})</span>}
              {/* R2-13: a step's source/drawing reference must reach the
                 reviewer too, not just torques' source. */}
              {s.source && <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>Ref: {s.source}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p>No steps.</p>
      )}

      <h4>Torques</h4>
      {torqueRows.length > 0 ? (
        <ul>
          {torqueRows.map((t, i) => (
            <li key={i}>
              {t.what} — {t.value}
              {t.pattern ? `, pattern: ${t.pattern}` : ""}
              {t.threadLocker ? `, thread-locker: ${t.threadLocker}` : ""}
              <div style={{ fontSize: "15px", color: "var(--fl-muted)" }}>Source: {t.source}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p>No torques.</p>
      )}

      <h4>Return-to-service checks</h4>
      {body.returnToService.length > 0 ? (
        <ul>
          {body.returnToService.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      ) : (
        <p>None listed.</p>
      )}

      {/* R2-13: the template author's own notes must reach the reviewer —
         they were stored but silently never shown here. */}
      <h4>Template notes</h4>
      <p>{body.notes || "None written."}</p>

      <button
        type="button"
        style={BUTTON_STYLE}
        disabled={busy}
        onClick={onMarkReviewed}
        data-testid={`job-sheets-library-mark-reviewed-${testIdPrefix}`}
      >
        {busy ? "Marking reviewed…" : "Mark reviewed"}
      </button>{" "}
      <button type="button" style={GHOST_BUTTON_STYLE} onClick={onCancel}>
        Cancel
      </button>
    </div>
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
