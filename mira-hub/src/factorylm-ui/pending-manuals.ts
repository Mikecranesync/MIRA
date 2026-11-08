/**
 * #5302: manuals saved into a project that are not (yet) one of its sources.
 *
 * New Project setup can close while a PDF is still being read (202 indexing).
 * The file is already saved on the project's node; only the source attach is
 * left. This module derives that state from the server (the node's file list
 * joined to the project's sources), so it survives a closed sheet, a reload and
 * another device, and it needs no client-side record.
 *
 * Document ids come from GET /api/files/{fileId} (the node list omits them).
 * Writes: only `POST /api/equipment-notebooks/{id}/sources/` (the existing,
 * idempotent upsert), only for files the technician approved at Create project
 * in this session, and always to the project the file belongs to.
 */
import { call, type HttpResult, type SetupDeps } from "./new-project-setup-logic";

export type PendingManual = {
  fileId: string;
  filename: string;
  /** The indexed document id once readable; null while still being read. */
  docId: string | null;
  state: "reading" | "readable";
};

type SourceRef = { docId: string; fileId: string | null };

/** A PDF filed on the project's node that is not a source by file id; its document is not yet known. */
export type FiledManual = { fileId: string; filename: string; indexed: boolean };

/**
 * PDFs filed on the project's node (the node file list is the durable filing
 * record: the node itself or a workspace_file_links row) that are not one of
 * its sources by file id. Eligibility is filing, never the stored file's age:
 * identical bytes reuse an older stored file (parkOrReuseFile). The list does
 * not carry the document id; `indexed` only says one exists.
 */
export function filedManuals(body: unknown, sources: readonly SourceRef[]): FiledManual[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const sourceFiles = new Set(sources.map((s) => s.fileId).filter((id): id is string => !!id));
  const out: FiledManual[] = [];
  for (const raw of files) {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (typeof f.id !== "string" || !f.id || f.source !== "direct" || f.mime_type !== "application/pdf") continue;
    if (sourceFiles.has(f.id)) continue;
    const filename = typeof f.filename === "string" && f.filename ? f.filename : "Document";
    out.push({ fileId: f.id, filename, indexed: f.indexed === true });
  }
  return out;
}

/**
 * The document behind a filed PDF, from the existing file lookup
 * (GET /api/files/{fileId} → file.uploadId, the same contract the setup sheet
 * follows). "gone": the file no longer exists. "unknown": the read failed.
 */
async function documentOf(fileId: string, deps: SetupDeps): Promise<string | null | "gone" | "unknown"> {
  const res = await call(deps, "GET", `/api/files/${encodeURIComponent(fileId)}`);
  if (res.status === 404) return "gone";
  if (!res.ok) return "unknown";
  const uploadId = (res.body.file as { uploadId?: unknown } | undefined)?.uploadId;
  return typeof uploadId === "string" && uploadId ? uploadId : null;
}

export type PendingCheck = {
  /** false: the file list could not be read, or the check went stale; nothing was written. */
  ok: boolean;
  pending: PendingManual[];
  /** File ids attached as sources by this check. */
  attached: string[];
  failed: Array<{ fileId: string; message: string }>;
  /** Display name of every file this check found, attached ones included. */
  filenames: Record<string, string>;
};

export const ATTACH_FAILED = "Couldn't be added as a source. Try again.";

/**
 * One read of the project's files; attaches each readable file in `approved`.
 * `stale()` true (the project closed or changed) stops before any write.
 */
export async function checkPendingManuals(
  input: { notebookId: string; nodeId: string; sources: readonly SourceRef[]; approved: ReadonlySet<string> },
  deps: SetupDeps,
  stale: () => boolean = () => false,
): Promise<PendingCheck> {
  const none: PendingCheck = { ok: false, pending: [], attached: [], failed: [], filenames: {} };
  const res = await call(deps, "GET", `/api/namespace/node/${encodeURIComponent(input.nodeId)}/files/`);
  if (!res.ok || stale()) return none;
  const filed = filedManuals(res.body, input.sources);
  const sourceDocs = new Set(input.sources.map((s) => s.docId));
  const pending: PendingManual[] = [];
  for (const f of filed) {
    let docId: string | null = null;
    if (f.indexed) {
      const doc = await documentOf(f.fileId, deps);
      if (stale()) return none;
      if (doc === "gone") continue;
      if (doc !== "unknown") docId = doc;
    }
    if (docId && sourceDocs.has(docId)) continue;
    pending.push({ fileId: f.fileId, filename: f.filename, docId, state: docId ? "readable" : "reading" });
  }
  const filenames = Object.fromEntries(pending.map((p) => [p.fileId, p.filename]));
  const attached: string[] = [];
  const failed: PendingCheck["failed"] = [];
  for (const p of pending) {
    if (p.state !== "readable" || !p.docId || !input.approved.has(p.fileId)) continue;
    if (stale()) return { ok: false, pending, attached, failed, filenames };
    const att = await attach(input.notebookId, p.docId, deps);
    if (att.ok) attached.push(p.fileId);
    else failed.push({ fileId: p.fileId, message: attachMessage(att) });
  }
  return { ok: true, pending: pending.filter((p) => !attached.includes(p.fileId)), attached, failed, filenames };
}

/** One explicit Add (a technician tap): attach a readable file to this project. */
export async function addPendingManual(notebookId: string, docId: string, deps: SetupDeps): Promise<{ ok: boolean; message: string | null }> {
  const att = await attach(notebookId, docId, deps);
  return att.ok ? { ok: true, message: null } : { ok: false, message: attachMessage(att) };
}

/** The existing sources door; the server upserts, so a repeat never duplicates the source. */
const attach = (notebookId: string, docId: string, deps: SetupDeps) =>
  call(deps, "POST", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/`, { json: { docId, sourceRole: "manual" } });

const attachMessage = (res: HttpResult) => (res.status === 401 ? "Sign in again to continue." : ATTACH_FAILED);
