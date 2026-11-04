/**
 * Pure helpers for the "Job sheets" library UI (TASK-S4): search a tenant's
 * job sheet templates, the DRAFT badge, and the import-preview row shape.
 * No React, no fetch — unit-tests in the hub's node vitest environment, same
 * pattern as machine-observations-logic.ts.
 */
import type { JobSheetRevisionStatus, JobSheetSummary } from "@/capabilities/living-sheet/job-sheet-store";
import type { ImportPreview } from "@/capabilities/living-sheet/job-sheet-import";
import type { JobSheetTorque } from "@/capabilities/living-sheet/types";

/** Find a job sheet by title / machine / component (case-insensitive substring
 *  over the sheet's LATEST revision — the thing the technician is looking
 *  at in the library list). A blank query returns the list unchanged, in
 *  its given order. */
export function searchJobSheets(list: JobSheetSummary[], query: string): JobSheetSummary[] {
  const q = query.trim().toLowerCase();
  if (q === "") return list;
  return list.filter((sheet) => {
    const body = sheet.latest.body;
    const haystack = [body.title, body.machineLabel, body.component]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/** "Drafts show a DRAFT badge everywhere and in the job they start" (spec).
 *  A reviewed revision shows no badge — reviewed is the unmarked, normal
 *  state; draft is the thing that needs calling out. */
export function draftBadge(status: JobSheetRevisionStatus): "DRAFT" | null {
  return status === "draft" ? "DRAFT" : null;
}

/** One row of the import preview table: either a job that will be saved (ok,
 *  or ok-with-warnings) or a row the importer refused outright. Refused rows
 *  carry no warnings of their own — they were never parsed into a body. */
export type PreviewRow =
  | { status: "ok" | "warning"; title: string; sourceJobId: string | null; warnings: string[] }
  | { status: "refused"; title: string; reason: string };

export type TorqueDisplayRow = { what: string; value: string; pattern: string | null; threadLocker: string | null; source: string };

/** F12: the reviewer must see the parsed recipe's torque rows — value AND
 *  source — before "Mark reviewed", not just the preview's title/status/
 *  warnings. Same wording convention as LivingSheet.tsx's stepConfirmDetail
 *  (a missing value/source says so plainly; it is never left blank or
 *  invented). */
export function torqueDisplayRows(torques: readonly JobSheetTorque[]): TorqueDisplayRow[] {
  return torques.map((t) => ({
    what: t.what,
    value: t.value === null ? "not written on the job sheet" : `${t.value}${t.unit ? ` ${t.unit}` : ""}`,
    pattern: t.pattern,
    threadLocker: t.threadLocker,
    source: t.source ?? "no source — unverified",
  }));
}

/** R2-21: decide whether a fresh `Preview` click should REUSE the existing
 *  per-job save-request ids (and keep whatever save results/successes are
 *  already recorded), or mint a brand-new set. Reuse only when the pasted
 *  text is byte-identical to the last preview AND the job count lines up
 *  with the existing id list — anything else (the very first preview, a
 *  genuinely different paste, or a shape mismatch) starts clean.
 *
 *  Why this matters: a technician who re-clicks "Preview" to recover after
 *  a lost save response must not get fresh ids for jobs whose save may have
 *  already committed server-side — a fresh id on retry would create a
 *  SECOND job sheet instead of replaying the original idempotent request. */
export function shouldReuseSaveIds(
  lastPreviewedText: string | null,
  nextPreviewedText: string,
  existingIdCount: number,
  nextJobCount: number,
): boolean {
  return nextJobCount > 0 && lastPreviewedText === nextPreviewedText && existingIdCount === nextJobCount;
}

/** R2-21: which preview-row indices (0-based) still need a save attempt.
 *  A row already recorded as successful never retries — a failed row, or
 *  one never attempted, does. */
export function indicesToRetry(jobCount: number, saveSuccess: Readonly<Record<number, boolean>>): number[] {
  const out: number[] = [];
  for (let i = 0; i < jobCount; i++) {
    if (!saveSuccess[i]) out.push(i);
  }
  return out;
}

/** R2-21: the Save-as-draft action is done — disable it — only once EVERY
 *  row has a recorded success. A mix of success/failure, or no attempt at
 *  all, must stay actionable so a failed row can be retried with its SAME
 *  request id. (Disabling on "any result exists", success or failure, is
 *  the bug this guards: it permanently locked out retry after one failure.) */
export function allRowsSaved(jobCount: number, saveSuccess: Readonly<Record<number, boolean>>): boolean {
  return jobCount > 0 && indicesToRetry(jobCount, saveSuccess).length === 0;
}

/** Flatten an ImportPreview into rows a table component can render directly,
 *  preserving parse order within `jobs` and within `refused`, jobs first.
 *  Writes nothing and calls nothing — `preview` already came from a prior
 *  POST to /api/job-sheets/import/preview. */
export function previewRows(preview: ImportPreview): PreviewRow[] {
  const jobRows: PreviewRow[] = preview.jobs.map((j) => ({
    status: j.warnings.length > 0 ? "warning" : "ok",
    title: j.body.title.trim() === "" ? "(untitled)" : j.body.title,
    sourceJobId: j.sourceJobId,
    warnings: j.warnings,
  }));
  const refusedRows: PreviewRow[] = preview.refused.map((r) => ({
    status: "refused",
    title: r.row,
    reason: r.reason,
  }));
  return [...jobRows, ...refusedRows];
}
