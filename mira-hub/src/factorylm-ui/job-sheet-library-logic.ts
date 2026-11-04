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
