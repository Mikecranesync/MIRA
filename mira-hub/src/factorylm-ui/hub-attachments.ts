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
 * The ids this send attached are ALWAYS in the returned scope, even when the
 * re-read fails or lags (Codex #4024 F2).
 *
 * Fail closed: an attachment that did not make it never lets its question go
 * out alone — least of all a photo question with no photo. That includes a
 * document that uploaded but cannot be indexed (F5), and a second photo the
 * one-photo turn contract cannot carry (F3).
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
  /** The scope to send with; always contains any document this send attached. */
  readonly scope?: readonly string[];
  /** The attachment did not make it; the caller must NOT send. */
  readonly failure?: string;
  /** false when re-attaching the same file cannot help (it was saved but is unreadable). */
  readonly reattach?: boolean;
}

/**
 * Pair each composer chip with the bytes the web adapter held for it. Throws —
 * which the Composer turns into a kept draft, kept chips and a plain error —
 * when any chip lost its bytes (a partial send would answer as though every
 * file were attached; Codex #4024 F1) or when more than one photo rides (the
 * turn carries one visualEvidence rider; F3).
 */
export function pairAttachments(
  attachments: readonly Attachment[],
  heldFile: (id: string) => File | undefined,
): HeldFile[] {
  const files: HeldFile[] = [];
  for (const attachment of attachments) {
    const file = heldFile(attachment.id);
    if (!file) throw new Error(`${attachment.name} is no longer available. Remove it and attach it again.`);
    files.push({ attachment, file });
  }
  if (files.filter((f) => f.attachment.kind === "photo").length > 1) {
    throw new Error("Attach one photo per question.");
  }
  return files;
}

/**
 * Resolve the namespace node a HOME send uploads into (every notebook owns one).
 * Never throws: the Composer has already cleared the draft, so a rejected read
 * must come back as a value the host turns into "here is your question back"
 * (Codex #4024 F4).
 */
export async function resolveUploadNode(
  read: () => Promise<{ status: number; data: { notebook?: { nodeId?: string | null } } | null }>,
): Promise<{ kind: "ok"; nodeId: string } | { kind: "signed_out" } | { kind: "failed" }> {
  try {
    const { status, data } = await read();
    if (status === 401) return { kind: "signed_out" };
    const nodeId = data?.notebook?.nodeId;
    return nodeId ? { kind: "ok", nodeId } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * One attached send as a single cancellable operation (round 2 F2): Stop or
 * opening another thread aborts `signal`, and once it is aborted the chat POST
 * never starts — neither after a successful upload nor after an upload the
 * abort interrupted. Returns what happened so the host can react.
 */
export async function runAttachedSend(opts: {
  signal: AbortSignal;
  compose: () => Promise<ComposedHubSend>;
  send: (composed: ComposedHubSend) => Promise<void>;
}): Promise<"sent" | "cancelled" | ComposedHubSend> {
  let composed: ComposedHubSend;
  try {
    composed = await opts.compose();
  } catch (error) {
    if (opts.signal.aborted) return "cancelled";
    throw error;
  }
  if (opts.signal.aborted) return "cancelled";
  if (composed.failure) return composed;
  await opts.send(composed);
  return "sent";
}

async function body(res: Response): Promise<Record<string, unknown>> {
  try {
    return ((await res.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function composeHubSend(
  opts: {
    text: string;
    files: readonly HeldFile[];
    notebookId: string;
    nodeId: string;
    threadId: string | null;
    /** The host's scope before this send. */
    baseScope: readonly string[];
  },
  deps: HubUploadDeps,
): Promise<ComposedHubSend> {
  const text = opts.text.trim();
  if (opts.files.length === 0) return { question: text, scope: opts.baseScope };

  const nb = encodeURIComponent(opts.notebookId);
  const photos = opts.files.filter((f) => f.attachment.kind === "photo");
  const photo = photos[0];
  const documents = opts.files.filter((f) => f.attachment.kind !== "photo");
  const question = text || (photo ? "What am I looking at, and what should I check?" : "What is in this document?");

  // The chat turn carries ONE visualEvidence rider (same as mobile); refuse
  // before any upload rather than silently dropping the second photo.
  if (photos.length > 1) return { question, failure: "Attach one photo per question." };

  const tooBig = opts.files.find((f) => f.file.size > deps.maxUploadMb * 1024 * 1024);
  if (tooBig) return { question, failure: `${tooBig.attachment.name} is over the ${deps.maxUploadMb} MB limit.` };

  let scope: readonly string[] = opts.baseScope;
  if (documents.length > 0) {
    const attached: string[] = [];
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
        // Parked but not searchable (image-only PDF etc.). The question was
        // about this file, so answering without it would be a general answer
        // dressed as a grounded one (Codex #4024 F5): stop and say so.
        return {
          question,
          reattach: false,
          failure: `${doc.attachment.name} was saved to this project, but it couldn't be read for chat${
            typeof d.warning === "string" && d.warning ? ` (${d.warning})` : ""
          }, so I didn't send your question. Try a text-based PDF, or send the question without the file.`,
        };
      }
      const att = await deps.fetch(`${deps.apiBase}/api/equipment-notebooks/${nb}/sources/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: d.uploadId, sourceRole: "manual" }),
      });
      if (!att.ok) {
        return { question, failure: `${doc.attachment.name} uploaded, but it couldn't be added as a source — try again.` };
      }
      attached.push(String(d.uploadId));
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
      // Keep the base scope; the attached ids are added below either way.
    }
    // The documents this send attached ride it no matter what the re-read said.
    scope = [...scope, ...attached.filter((id) => !scope.includes(id))];
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
    // The chat route re-verifies that the photo is LINKED to this notebook and
    // silently ignores it otherwise (verifyVisualEntry) — so an unlinked photo
    // would be a photo question answered without the photo (round 2 F1).
    const link = d.attachment as { linkId?: unknown } | null | undefined;
    if (!link || typeof link.linkId !== "string" || !link.linkId) {
      return { question, failure: "The photo didn't attach to this project — try again." };
    }
    visualEvidence = {
      fileId,
      capturedAt: typeof obs.capturedAt === "string" ? obs.capturedAt : new Date().toISOString(),
    };
  }

  return { question, scope, ...(visualEvidence ? { visualEvidence } : {}) };
}
