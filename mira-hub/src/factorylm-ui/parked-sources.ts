/**
 * #5456: sources of this project that chat will not search, and the one step
 * that would change that. A manual the automatic search saved switched off is
 * a source, so the pending-manuals box (files that are not sources yet) never
 * listed it and the grounding line never counted it: on this screen it was
 * invisible, while the chat told the technician to "check it in Sources".
 *
 * Which documents are unsearchable, why, and what the step is are all the
 * server's (`deriveSearchable` in lib/document-readiness.ts). Nothing here
 * re-derives them; the host re-reads the project after a write.
 */
import type { NotebookSource } from "@/lib/equipment-notebooks";
import { call, type SetupDeps } from "./new-project-setup-logic";

export type ParkedSource = Pick<NotebookSource, "docId" | "filename" | "fileId" | "matchState" | "searchable" | "searchableLabel" | "searchableFix">;

export type ParkedRow = {
  docId: string;
  name: string;
  fileId: string | null;
  label: string;
  fix: "use" | "full_manual" | "wait";
  /** Only a suggestion needs approving; a verified source keeps its state. */
  needsApproval: boolean;
};

/** A response from a server without the projection has no `searchable` field;
 *  such a source is not listed (unknown is not "parked"). */
export function parkedRows(sources: ReadonlyArray<ParkedSource>): ParkedRow[] {
  const rows: ParkedRow[] = [];
  for (const s of sources) {
    if (s.searchable !== false || s.matchState === "rejected" || !s.docId) continue;
    const fix = s.searchableFix;
    if (fix !== "use" && fix !== "full_manual" && fix !== "wait") continue;
    rows.push({ docId: s.docId, name: s.filename || "Document", fileId: s.fileId ?? null, label: s.searchableLabel, fix, needsApproval: s.matchState === "candidate" });
  }
  return rows;
}

export const USE_FAILED = "Couldn't turn this manual on. Check the connection and try again.";
export const REREAD_FAILED = "Turned on, but this list couldn't be refreshed. Try again.";
export const USE_GONE = "This manual is no longer in this project.";
export const USE_SIGNED_OUT = "Sign in again to continue.";

/**
 * Approve and switch on in ONE write. Switching on alone leaves a suggestion
 * unapproved, and the server then refuses every question in the project
 * (`source_not_in_notebook`). Refuses any row whose step is not "use": a
 * partial manual is never turned on by confirming it.
 */
export async function turnOnParkedSource(notebookId: string, row: Pick<ParkedRow, "docId" | "fix" | "needsApproval">, deps: SetupDeps): Promise<{ ok: true } | { ok: false; message: string }> {
  if (row.fix !== "use") return { ok: false, message: USE_FAILED };
  const json = row.needsApproval ? { enabledByDefault: true, matchState: "user_confirmed" } : { enabledByDefault: true };
  const res = await call(deps, "PATCH", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(row.docId)}/`, { json });
  if (res.ok) return { ok: true };
  return { ok: false, message: res.status === 401 ? USE_SIGNED_OUT : res.status === 404 ? USE_GONE : USE_FAILED };
}

/** Names to confirm as "now used": turned on here AND the server's list now
 *  says chat searches it. Absence proves nothing: a source that was removed,
 *  rejected or switched off again elsewhere is not "used" (Codex r1 F2, #5488). */
export function confirmedOn(turnedOn: ReadonlyArray<{ docId: string; name: string }>, sources: ReadonlyArray<Pick<ParkedSource, "docId" | "searchable">>): string[] {
  const searched = new Set(sources.filter((s) => s.searchable === true).map((s) => s.docId));
  return turnedOn.filter((t) => searched.has(t.docId)).map((t) => t.name);
}

export type TurnOnOutcome = { kind: "on" } | { kind: "failed"; message: string };

/**
 * One tap on "Use this manual": the write, then the host's re-read of the
 * project. The row stays in `inFlight` until that re-read settles, because the
 * list on screen is the server's and nothing here says "on" before it does.
 *  - A second tap while the first is in flight sends nothing (resolves null).
 *  - A refused or lost write is never followed by a re-read.
 *  - An accepted write whose re-read fails says so; the row is still listed, and
 *    tapping again repeats the same idempotent write and re-reads.
 * `onBusy` fires whenever `inFlight` changed.
 */
export async function turnOnAndReread(
  notebookId: string,
  row: Pick<ParkedRow, "docId" | "fix" | "needsApproval">,
  inFlight: Set<string>,
  io: { deps: SetupDeps; reread: () => Promise<boolean>; onBusy: () => void },
): Promise<TurnOnOutcome | null> {
  if (inFlight.has(row.docId)) return null;
  inFlight.add(row.docId);
  io.onBusy();
  try {
    const write = await turnOnParkedSource(notebookId, row, io.deps);
    if (!write.ok) return { kind: "failed", message: write.message };
    let landed = false;
    try {
      landed = await io.reread();
    } catch {
      landed = false;
    }
    return landed ? { kind: "on" } : { kind: "failed", message: REREAD_FAILED };
  } finally {
    inFlight.delete(row.docId);
    io.onBusy();
  }
}
