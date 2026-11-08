/**
 * #5302: manuals saved into a project that are not (yet) one of its sources.
 *
 * New Project setup can close while a PDF is still being read (202 indexing).
 * The file is already saved on the project's node; only the source attach is
 * left. This module derives that state from the server (the node's file list
 * joined to the project's sources), so it survives a closed sheet, a reload and
 * another device, and it needs no client-side record.
 *
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

/**
 * PDFs parked directly on the project's node, saved since the project was
 * created, that are not one of its sources (by file id or document id).
 */
export function pendingManuals(body: unknown, sources: readonly SourceRef[], createdAt: string): PendingManual[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  const since = Date.parse(createdAt);
  const sourceFiles = new Set(sources.map((s) => s.fileId).filter((id): id is string => !!id));
  const sourceDocs = new Set(sources.map((s) => s.docId));
  const out: PendingManual[] = [];
  for (const raw of files) {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (typeof f.id !== "string" || !f.id || f.source !== "direct" || f.mime_type !== "application/pdf") continue;
    const at = typeof f.created_at === "string" ? Date.parse(f.created_at) : NaN;
    if (!Number.isFinite(since) || !Number.isFinite(at) || at < since) continue;
    const docId = typeof f.upload_id === "string" && f.upload_id ? f.upload_id : null;
    if (sourceFiles.has(f.id) || (docId && sourceDocs.has(docId))) continue;
    const filename = typeof f.filename === "string" && f.filename ? f.filename : "Document";
    out.push({ fileId: f.id, filename, docId, state: docId ? "readable" : "reading" });
  }
  return out;
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
  input: { notebookId: string; nodeId: string; createdAt: string; sources: readonly SourceRef[]; approved: ReadonlySet<string> },
  deps: SetupDeps,
  stale: () => boolean = () => false,
): Promise<PendingCheck> {
  const none: PendingCheck = { ok: false, pending: [], attached: [], failed: [], filenames: {} };
  const res = await call(deps, "GET", `/api/namespace/node/${encodeURIComponent(input.nodeId)}/files/`);
  if (!res.ok || stale()) return none;
  const pending = pendingManuals(res.body, input.sources, input.createdAt);
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
