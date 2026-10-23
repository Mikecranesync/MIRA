/**
 * Keep a technician photo as a source on its machine.
 *
 * A photo attached in chat (`/look`) leaves an observation that only the same
 * conversation can recall: `visual_session.asset_id` is NULL and the turn
 * history is thread-scoped. A technician who photographs a print, then opens a
 * new conversation on the same machine the next day, gets "send me the drawing
 * again". Keeping the photo turns its stored observation into a notebook
 * source, so every later conversation on that machine can retrieve it, and its
 * citation opens the original photograph (`origin_file_id`).
 *
 * Evidence classes stay separate (materialized-evidence rules 3 and 9):
 * - What the technician confirms by pressing Keep is the ASSOCIATION: this
 *   photo belongs to this machine. That is recorded as `user_confirmed`.
 * - The text is the vision model's reading of the photo. It stays an
 *   unconfirmed transcription: the chunks are NOT marked `verified` (unlike a
 *   nameplate the technician reviewed field by field), the document says so in
 *   its own header, and the observation row keeps `review_state='unreviewed'`.
 * - Nothing here interprets the photo. No new model call, no inferred machine
 *   facts: only what `/look` already observed.
 *
 * Reuses the nameplate lane's seams: park + atomic ingest claim + text ingest
 * ({@link materializeDerivedTextDoc}), `attachSource` with `origin_file_id`, and
 * `supersedePriorOriginSources`. No new table.
 */
import { attachSource, findVisibleOriginSource, supersedePriorOriginSources } from "@/lib/equipment-notebooks";
import { deleteOrphanNodeIngest, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { withTenantContext } from "@/lib/tenant-context";
import {
  claimIngest,
  linkFileToUpload,
  parkOrReuseFile,
  photoLinkedToTarget,
  releaseIngestClaim,
} from "@/lib/workspace-files";
import { loadVisualEvidenceForPhoto } from "@/lib/visual-evidence-context";

/**
 * Park a generated text document and ingest it once, under the same canonical
 * dedup and atomic claim every other document uses. Identical bytes reuse the
 * existing document; a concurrent request materializing the same bytes yields
 * `null` rather than a second chunk set.
 */
export async function materializeDerivedTextDoc(opts: {
  readonly tenantId: string;
  readonly nodeId: string;
  readonly filename: string;
  readonly text: string;
  readonly createdBy: string | null;
  /** `namespace_direct_uploads.source` tag, e.g. "nameplate_text". */
  readonly source: string;
}): Promise<{ docId: string | null; chunkCount: number }> {
  const buffer = Buffer.from(opts.text, "utf8");
  const parked = await parkOrReuseFile({
    tenantId: opts.tenantId,
    filename: opts.filename,
    mimeType: "text/plain",
    sizeBytes: buffer.length,
    buffer,
    createdBy: opts.createdBy,
    nodeId: opts.nodeId,
    source: opts.source,
  });
  if (parked.uploadId !== null) return { docId: parked.uploadId, chunkCount: 0 };

  const claim = await claimIngest(opts.tenantId, parked.fileId);
  if (!claim.claimed) {
    // already_ingested: another request finished it; ingest_in_progress: one is
    // running now. Either way, do not ingest a second time.
    return { docId: claim.reason === "already_ingested" ? claim.uploadId : null, chunkCount: 0 };
  }
  try {
    const ingested = await ingestTextToNode({
      tenantId: opts.tenantId,
      nodeId: opts.nodeId,
      unsPath: null,
      filename: opts.filename,
      mimeType: "text/plain",
      sizeBytes: buffer.length,
      buffer,
    });
    // Token-fenced finalize: only claim the pointer while we still own the
    // claim. A lost fence means our chunk set duplicates the winner's.
    const won = await linkFileToUpload(opts.tenantId, parked.fileId, ingested.uploadId, claim.claimToken);
    if (!won) {
      await deleteOrphanNodeIngest(opts.tenantId, ingested.uploadId);
      return { docId: null, chunkCount: 0 };
    }
    return { docId: ingested.uploadId, chunkCount: ingested.chunkCount };
  } catch (err) {
    await releaseIngestClaim(opts.tenantId, parked.fileId, claim.claimToken).catch(() => {});
    throw err;
  }
}

/** The header states, inside the document, what kind of evidence it is. */
export function buildPhotoSourceText(opts: {
  readonly machineName: string;
  readonly fileId: string;
  readonly photoSha256: string | null;
  readonly capturedAt: string | null;
  readonly observation: string;
}): string {
  return [
    "Photo source: technician photo",
    `Machine: ${opts.machineName}`,
    "Evidence: a vision model's transcription of a technician's photo. The technician confirmed this photo belongs to this machine; the transcription itself is NOT technician-verified. Check any identifier against the original photo before acting on it.",
    `Photo file: ${opts.fileId}`,
    ...(opts.photoSha256 ? [`Photo sha256: ${opts.photoSha256}`] : []),
    ...(opts.capturedAt ? [`Captured: ${opts.capturedAt}`] : []),
    "",
    "What the photo shows:",
    opts.observation.trim(),
    "",
  ].join("\n");
}

export type KeepPhotoResult =
  | { readonly ok: true; readonly docId: string; readonly alreadyKept: boolean; readonly chunkCount: number }
  | { readonly ok: false; readonly status: 404 | 409 | 503; readonly error: string };

/**
 * Keep a photo already linked to this notebook as one of its sources.
 * Idempotent: a photo that already has a visible derived source (kept earlier,
 * or confirmed as a nameplate) returns that source and changes nothing.
 */
export async function keepPhotoAsSource(opts: {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly notebook: { readonly id: string; readonly nodeId: string; readonly displayName: string };
  readonly fileId: string;
}): Promise<KeepPhotoResult> {
  const { tenantId, notebook, fileId } = opts;
  // The link is the server's proof the photo was attached to THIS machine; a
  // file id from another notebook or tenant is indistinguishable from none.
  const photo = await photoLinkedToTarget(tenantId, fileId, "equipment_notebook", notebook.id);
  if (!photo) return { ok: false, status: 404, error: "photo_not_found" };

  const existing = await findVisibleOriginSource(tenantId, notebook.id, fileId);
  if (existing) return { ok: true, docId: existing.docId, alreadyKept: true, chunkCount: 0 };

  const reading = await withTenantContext(tenantId, (c) => loadVisualEvidenceForPhoto(c, tenantId, fileId));
  // No stored reading means there is nothing citable to keep. Say so rather
  // than attach an empty document.
  if (!reading || reading.text.trim() === "") return { ok: false, status: 409, error: "no_photo_reading" };

  const text = buildPhotoSourceText({
    machineName: notebook.displayName,
    fileId,
    photoSha256: reading.photoHash,
    capturedAt: photo.capturedAt,
    observation: reading.text,
  });
  const materialized = await materializeDerivedTextDoc({
    tenantId,
    nodeId: notebook.nodeId,
    filename: `photo-${fileId}.txt`,
    text,
    createdBy: opts.userId,
    source: "photo_text",
  });
  if (!materialized.docId) return { ok: false, status: 503, error: "photo_source_in_progress" };

  const att = await attachSource(tenantId, notebook.id, materialized.docId, {
    matchState: "user_confirmed",
    sourceRole: "photo",
    addedBy: opts.userId,
    originFileId: fileId,
    matchEvidence: { kept_from_observation: reading.observationId },
  });
  if (!att.ok) return { ok: false, status: 503, error: `attach_source_failed:${att.error}` };
  // One photograph, one visible source (085 Invariant 1).
  await supersedePriorOriginSources(tenantId, notebook.id, fileId, materialized.docId).catch(() => []);
  return { ok: true, docId: materialized.docId, alreadyKept: false, chunkCount: materialized.chunkCount };
}
