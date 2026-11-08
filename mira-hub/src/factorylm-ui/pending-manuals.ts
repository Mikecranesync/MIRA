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
import { call, messageOf, type HttpResult, type SetupDeps } from "./new-project-setup-logic";

export type PendingManual = {
  fileId: string;
  filename: string;
  /** The indexed document id once readable; null otherwise. */
  docId: string | null;
  /**
   * reading: the server confirms an ingest of this file is running now.
   * readable: it has a document and can become a source.
   * unread (#5316): no document and no ingest running, so it is not being read
   * (a failed or abandoned ingest). It needs Upload again, never a wait.
   */
  state: "reading" | "readable" | "unread";
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
 * follows), and whether the server holds a live ingest on it (file.ingesting,
 * #5316). "gone": the file no longer exists. "unknown": the read failed.
 */
async function documentOf(fileId: string, deps: SetupDeps): Promise<{ docId: string | null; ingesting: boolean } | "gone" | "unknown"> {
  const res = await call(deps, "GET", `/api/files/${encodeURIComponent(fileId)}`);
  if (res.status === 404) return "gone";
  if (!res.ok) return "unknown";
  const file = (res.body.file ?? {}) as { uploadId?: unknown; ingesting?: unknown };
  const docId = typeof file.uploadId === "string" && file.uploadId ? file.uploadId : null;
  return { docId, ingesting: file.ingesting === true };
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
    // Every filed PDF is looked up: the list's `indexed` flag cannot say whether
    // reading is underway, and an unproven "still being read" is the #5316 lie.
    const doc = await documentOf(f.fileId, deps);
    if (stale()) return none;
    if (doc === "gone") continue;
    // A failed lookup proves nothing either way: report the check failed (the
    // panel offers Check again) rather than guess reading.
    if (doc === "unknown") return none;
    if (doc.docId && sourceDocs.has(doc.docId)) continue;
    const state = doc.docId ? "readable" : doc.ingesting ? "reading" : "unread";
    pending.push({ fileId: f.fileId, filename: f.filename, docId: doc.docId, state });
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

export type ReuploadOutcome =
  | { kind: "attached"; docId: string }
  | { kind: "reading" }
  | { kind: "unread"; message: string }
  | { kind: "failed"; message: string };

export const REUPLOAD_FAILED = "Couldn't upload this file. Try again.";
export const NOT_READ = "This file couldn't be read. Try another copy of the PDF.";

/**
 * #5316 Upload again (a technician tap with the PDF picked again): re-send it
 * through the same node upload the setup sheet uses, to this project's own node.
 * A returned document (fresh, or the existing one for identical bytes) is
 * attached to this project once; a 202 is being read now; anything else is
 * reported, never shown as reading.
 */
export async function reuploadPendingManual(
  input: { notebookId: string; nodeId: string; file: File },
  deps: SetupDeps,
): Promise<ReuploadOutcome> {
  const form = new FormData();
  form.append("file", input.file);
  const up = await call(deps, "POST", `/api/namespace/node/${encodeURIComponent(input.nodeId)}/files/`, { form });
  if (!up.ok) return { kind: "failed", message: messageOf(up, REUPLOAD_FAILED) };
  if (up.status === 202 && up.body.indexing === true) return { kind: "reading" };
  const docId = up.body.uploadId;
  if (up.body.indexed === true && typeof docId === "string" && docId) {
    const att = await attach(input.notebookId, docId, deps);
    return att.ok ? { kind: "attached", docId } : { kind: "failed", message: attachMessage(att) };
  }
  const warning = up.body.warning;
  return { kind: "unread", message: typeof warning === "string" && warning ? warning : NOT_READ };
}

/** The existing sources door; the server upserts, so a repeat never duplicates the source. */
const attach = (notebookId: string, docId: string, deps: SetupDeps) =>
  call(deps, "POST", `/api/equipment-notebooks/${encodeURIComponent(notebookId)}/sources/`, { json: { docId, sourceRole: "manual" } });

const attachMessage = (res: HttpResult) => (res.status === 401 ? "Sign in again to continue." : ATTACH_FAILED);
