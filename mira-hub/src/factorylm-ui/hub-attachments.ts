/**
 * Composer attachments for the Hub host (#4019) — the web twin of
 * `mira-mobile/src/unified/attachments.ts` after #4014.
 *
 * Runs BEFORE the one canonical send and decides only WHEN the existing doors
 * run; it owns no transport of its own:
 *  - documents: `POST /api/namespace/node/{nodeId}/files/` then
 *    `POST /api/equipment-notebooks/{id}/sources/` — the classic notebook
 *    page's and mobile's two-step source upload, verbatim. The sources door
 *    sets `matchState = "user_confirmed"`, so the upload is citable at once.
 *  - photos: `POST /api/equipment-notebooks/{id}/look/` — parks + links the
 *    photo and returns the fileId the `visualEvidence` rider carries.
 *
 * After a document upload the notebook's scope is re-read, because the host's
 * `docIds` were computed before the upload: sending with them would answer the
 * very turn the manual was attached to without the manual (the #4014 class).
 *
 * Fail closed: an attachment that did not make it never lets its question go
 * out alone — least of all a photo question with no photo.
 */
import type { Attachment } from "../../../packages/factorylm-interaction/src";
import { enabledDocIds } from "./hub-host-logic";

/** Same copy as mobile (#3837), so both surfaces say the same thing. */
export const PHOTO_ANALYSIS_UNAVAILABLE =
  "The photo was saved, but MIRA couldn't analyze it. Try another photo before asking about it.";

export interface HubUploadDeps {
  fetch: typeof fetch;
  apiBase: string;
  /** Idempotency key for /look (a retry replays the same link). */
  newKey(): string;
  maxUploadMb: number;
}

export interface HeldFile {
  readonly attachment: Attachment;
  readonly file: File;
}

export interface ComposedHubSend {
  /** The technician's words, or an honest default when only a file was sent. */
  readonly question: string;
  /** Present only when a photo was attached and read. */
  readonly visualEvidence?: { fileId: string; capturedAt: string };
  /** The scope re-read after a document upload; absent = keep the host's. */
  readonly scope?: readonly string[];
  /** A document uploaded but is not searchable — say so with the answer. */
  readonly warning?: string;
  /** The attachment did not make it; the caller must NOT send. */
  readonly failure?: string;
}

async function body(res: Response): Promise<Record<string, unknown>> {
  try {
    return ((await res.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function composeHubSend(
  opts: { text: string; files: readonly HeldFile[]; notebookId: string; nodeId: string; threadId: string | null },
  deps: HubUploadDeps,
): Promise<ComposedHubSend> {
  const text = opts.text.trim();
  if (opts.files.length === 0) return { question: text };

  const nb = encodeURIComponent(opts.notebookId);
  const photo = opts.files.find((f) => f.attachment.kind === "photo");
  const documents = opts.files.filter((f) => f.attachment.kind !== "photo");
  const question = text || (photo ? "What am I looking at, and what should I check?" : "What is in this document?");

  const tooBig = opts.files.find((f) => f.file.size > deps.maxUploadMb * 1024 * 1024);
  if (tooBig) return { question, failure: `${tooBig.attachment.name} is over the ${deps.maxUploadMb} MB limit.` };

  let warning: string | undefined;
  let scope: readonly string[] | undefined;
  if (documents.length > 0) {
    for (const doc of documents) {
      const fd = new FormData();
      fd.append("file", doc.file);
      const up = await deps.fetch(`${deps.apiBase}/api/namespace/node/${encodeURIComponent(opts.nodeId)}/files/`, {
        method: "POST",
        body: fd,
      });
      const d = await body(up);
      if (!up.ok) {
        return { question, failure: `${doc.attachment.name} didn't upload — try again.` };
      }
      if (!d.indexed || !d.uploadId) {
        // Parked but not searchable (image-only PDF etc.) — honest, not silent.
        warning = `${doc.attachment.name} was saved, but it couldn't be indexed for chat${
          typeof d.warning === "string" && d.warning ? ` (${d.warning})` : ""
        }.`;
        continue;
      }
      const att = await deps.fetch(`${deps.apiBase}/api/equipment-notebooks/${nb}/sources/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: d.uploadId, sourceRole: "manual" }),
      });
      if (!att.ok) {
        return { question, failure: `${doc.attachment.name} uploaded, but it couldn't be added as a source — try again.` };
      }
    }
    // A failed re-read leaves the host's scope in charge rather than failing an
    // upload that already succeeded.
    try {
      const q = opts.threadId ? `?threadId=${encodeURIComponent(opts.threadId)}` : "";
      const r = await deps.fetch(`${deps.apiBase}/api/equipment-notebooks/${nb}/${q}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (r.ok) {
        const sources = (await body(r)).sources;
        if (Array.isArray(sources)) scope = enabledDocIds(sources as Parameters<typeof enabledDocIds>[0]);
      }
    } catch {
      scope = undefined;
    }
  }

  let visualEvidence: ComposedHubSend["visualEvidence"];
  if (photo) {
    const fd = new FormData();
    fd.append("image", photo.file);
    fd.append("clientKey", deps.newKey());
    if (opts.threadId) fd.append("threadId", opts.threadId);
    fd.append("question", question);
    const r = await deps.fetch(`${deps.apiBase}/api/equipment-notebooks/${nb}/look/`, { method: "POST", body: fd });
    const d = await body(r);
    // 502/503 still return the parked file with `observation: null`.
    const fileId = typeof d.fileId === "string" ? d.fileId : "";
    if (!fileId) return { question, failure: "The photo didn't upload — try again." };
    const obs = d.observation as { text?: unknown; capturedAt?: unknown } | null | undefined;
    if (!obs || typeof obs.text !== "string" || !obs.text.trim()) {
      return { question, failure: PHOTO_ANALYSIS_UNAVAILABLE };
    }
    visualEvidence = {
      fileId,
      capturedAt: typeof obs.capturedAt === "string" ? obs.capturedAt : new Date().toISOString(),
    };
  }

  return {
    question,
    ...(visualEvidence ? { visualEvidence } : {}),
    ...(scope ? { scope } : {}),
    ...(warning ? { warning } : {}),
  };
}
