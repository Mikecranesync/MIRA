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
 * - An explicit human review creates a scoped retained correction. Only its
 *   exact replacement text may become a technician-reviewed source. No new
 *   model call is made, and review is not an equipment-operation authorization.
 *
 * Reuses the nameplate lane's seams: park + atomic ingest claim + text ingest
 * ({@link materializeDerivedTextDoc}), `attachSource` with atomic origin reuse/replacement. No new table.
 */
import { attachSource, findVisibleOriginSource, markNameplateDocVerified } from "@/lib/equipment-notebooks";
import { deleteOrphanNodeIngest, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { withTenantContext } from "@/lib/tenant-context";
import {
  claimIngest,
  linkFileToUpload,
  parkOrReuseFile,
  photoLinkedToTarget,
  releaseIngestClaim,
} from "@/lib/workspace-files";
import { correctVisualObservations, loadVisualEvidenceForPhoto } from "@/lib/visual-evidence-context";

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
  readonly reviewed?: boolean;
}): string {
  return [
    "Photo source: technician photo",
    `Machine: ${opts.machineName}`,
    opts.reviewed ? "Evidence: technician-reviewed transcription of this photo. Review confirms the text, not a diagnosis or authorization to operate equipment." : "Evidence: a vision model's transcription of a technician's photo. The technician confirmed this photo belongs to this machine; the transcription itself is NOT technician-verified. Check any identifier against the original photo before acting on it.",
    `Photo file: ${opts.fileId}`,
    ...(opts.photoSha256 ? [`Photo sha256: ${opts.photoSha256}`] : []),
    ...(opts.capturedAt ? [`Captured: ${opts.capturedAt}`] : []),
    "",
    "What the photo shows:",
    opts.observation.trim(),
    "",
  ].join("\n");
}

/**
 * True when an answer's citations ALL point at kept photo readings: each one
 * derives from a photo (`originFileId`) and none of its retrieved chunks is
 * verified. Such an answer rests on an unconfirmed vision reading, not on
 * documentation, and must be labelled that way. A confirmed nameplate also
 * derives from a photo, but the technician reviewed it and its chunks are
 * verified, so it keeps the documentation label.
 */
export function citesOnlyUnconfirmedPhotoReadings(
  citations: readonly { readonly docId: string; readonly originFileId?: string | null }[],
  chunks: readonly { readonly docId?: string | null; readonly verified?: boolean }[],
): boolean {
  if (citations.length === 0) return false;
  return citations.every(
    (c) => !!c.originFileId && !chunks.some((k) => k.docId === c.docId && k.verified === true),
  );
}

export type KeepPhotoResult =
  | { readonly ok: true; readonly docId: string; readonly alreadyKept: boolean; readonly chunkCount: number }
  | { readonly ok: false; readonly status: 400 | 404 | 409 | 503; readonly error: string };

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
  /** The conversation the technician pressed Keep in: keep the reading they saw there. */
  readonly threadId?: string | null;
  readonly reviewed?: { readonly observationId: string; readonly text: string };
}): Promise<KeepPhotoResult> {
  const { tenantId, notebook, fileId } = opts;
  if (!opts.threadId || !opts.userId) return { ok: false, status: 400, error: "conversation_scope_required" };
  // The link is the server's proof the photo was attached to THIS machine; a
  // file id from another notebook or tenant is indistinguishable from none.
  const photo = await photoLinkedToTarget(tenantId, fileId, "equipment_notebook", notebook.id);
  if (!photo) return { ok: false, status: 404, error: "photo_not_found" };

  const existing = await findVisibleOriginSource(tenantId, notebook.id, fileId);
  if (existing && !opts.reviewed) return { ok: true, docId: existing.docId, alreadyKept: true, chunkCount: 0 };

  // Keep only this owner's explicit conversation, including "legacy".
  // Never fall back to a newer reading from another conversation or owner.
  const scope = { notebookId: notebook.id, ownerUserId: opts.userId, threadId: opts.threadId };
  let correctedId: string | undefined;
  if (opts.reviewed) {
    if (!scope || !opts.reviewed.text.trim() || opts.reviewed.text.trim().length > 20000)
      return { ok: false, status: 409, error: "photo_review_conflict" };
    const correction = await correctVisualObservations({
      tenantId, boundEntityId: null, fileId, correctedBy: opts.userId,
      conversation: scope,
      corrections: [{ observationId: opts.reviewed.observationId, value: opts.reviewed.text }],
    });
    correctedId = correction.corrected.find(r => r.supersededId === opts.reviewed!.observationId)?.replacementId;
    if (!correctedId) return { ok: false, status: 409, error: "photo_review_conflict" };
  }
  const reading = await withTenantContext(tenantId, (c) => loadVisualEvidenceForPhoto(c, tenantId, fileId, scope));
  // No stored reading means there is nothing citable to keep. Say so rather
  // than attach an empty document.
  if (!reading || reading.text.trim() === "") return { ok: false, status: 409, error: "no_photo_reading" };

  if (opts.reviewed && (reading.observationId !== correctedId || reading.text !== opts.reviewed.text.trim() || reading.trust !== "verified"))
    return { ok: false, status: 409, error: "photo_review_conflict" };
  const reviewed = reading.trust === "verified";
  const text = buildPhotoSourceText({
    machineName: notebook.displayName,
    fileId,
    photoSha256: reading.photoHash,
    capturedAt: photo.capturedAt,
    observation: reading.text,
    reviewed,
  });
  const materialized = await materializeDerivedTextDoc({
    tenantId,
    nodeId: notebook.nodeId,
    // The title rides on every chunk, so the trust state reaches the prompt and
    // the citation even when the header above lands in a different chunk.
    filename: `${reviewed ? "Technician-reviewed" : "Unconfirmed"} photo reading ${(photo.capturedAt ?? "").slice(0, 10) || fileId}.txt`,
    text,
    createdBy: opts.userId,
    source: "photo_text",
  });
  if (!materialized.docId) return { ok: false, status: 503, error: "photo_source_in_progress" };

  // Only this reviewed document may pass the retrieval approval gate.
  if (reviewed) await markNameplateDocVerified(tenantId, materialized.docId);
  const att = await attachSource(tenantId, notebook.id, materialized.docId, {
    matchState: "user_confirmed",
    sourceRole: "photo",
    addedBy: opts.userId,
    originFileId: fileId,
    ...(reviewed
      ? { reviewedPhoto: { observationId: reading.observationId, threadId: opts.threadId } }
      : { reuseVisibleOrigin: true, candidatePhoto: { observationId: reading.observationId, threadId: opts.threadId } }),
    matchEvidence: { kept_from_observation: reading.observationId },
  });
  if (!att.ok) return att.error === "photo_review_conflict"
    ? { ok: false, status: 409, error: att.error }
    : { ok: false, status: 503, error: `attach_source_failed:${att.error}` };
  return { ok: true, docId: att.docId ?? materialized.docId, alreadyKept: att.alreadyAttached ?? false,
    chunkCount: att.alreadyAttached ? 0 : materialized.chunkCount };
}
