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
 * - The text is the vision model's reading of the photo unless the technician
 *   reviews it. A Keep without the reviewed text is refused (`reading_required`)
 *   so a misread cannot be stored silently (#4643).
 * - A technician edit goes through the existing `correctVisualObservations`
 *   seam (original retained, `superseded_by`). Only that reviewed text is
 *   marked verified. An as-is keep stays an unconfirmed transcription.
 *
 * Reuses the nameplate lane's seams: park + atomic ingest claim + text ingest
 * ({@link materializeDerivedTextDoc}), `attachSource` with `origin_file_id`,
 * `correctVisualObservations`, and `markNameplateDocVerified`. No new table.
 */
import { attachSource, findVisibleOriginSource, markNameplateDocVerified, supersedePriorOriginSources } from "@/lib/equipment-notebooks";
import { deleteOrphanNodeIngest, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { withTenantContext } from "@/lib/tenant-context";
import {
  claimIngest,
  linkFileToUpload,
  parkOrReuseFile,
  photoLinkedToTarget,
  releaseIngestClaim,
} from "@/lib/workspace-files";
import { loadScreenTextLines } from "@/capabilities/screen-text";
import {
  correctVisualObservations,
  loadVisualEvidenceForPhoto,
  MAX_LOOK_CORRECTION_VALUE_CHARS,
} from "@/lib/visual-evidence-context";

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

/** The lines printed on a sheet or screen, stored beside the LOOK observation. */
export function composePhotoReadingForReview(
  observation: string,
  screenLines: readonly string[] | null | undefined,
): string {
  const body = observation.trim();
  if (!screenLines?.length) return body;
  return `${body}\n\nText on the sheet:\n${screenLines.map((line) => `- ${line}`).join("\n")}`;
}

/** The header states, inside the document, what kind of evidence it is. */
export function buildPhotoSourceText(opts: {
  readonly machineName: string;
  readonly fileId: string;
  readonly photoSha256: string | null;
  readonly capturedAt: string | null;
  readonly observation: string;
  readonly technicianConfirmed?: boolean;
}): string {
  const evidence = opts.technicianConfirmed
    ? "Evidence: a technician reviewed this photo reading and confirmed the text below. The original vision reading is retained as history."
    : "Evidence: a vision model's transcription of a technician's photo. The technician confirmed this photo belongs to this machine; the transcription itself is NOT technician-verified. Check any identifier against the original photo before acting on it.";
  return [
    "Photo source: technician photo",
    `Machine: ${opts.machineName}`,
    evidence,
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

/** True when every citation is a photo reading whose chunks a technician verified. */
export function citesOnlyTechnicianConfirmedPhotoReadings(
  citations: readonly { readonly docId: string; readonly originFileId?: string | null }[],
  chunks: readonly { readonly docId?: string | null; readonly verified?: boolean }[],
): boolean {
  if (citations.length === 0) return false;
  return citations.every(
    (c) => !!c.originFileId && chunks.some((k) => k.docId === c.docId && k.verified === true),
  );
}

export type KeepPhotoResult =
  | { readonly ok: true; readonly docId: string; readonly alreadyKept: boolean; readonly chunkCount: number }
  | { readonly ok: false; readonly status: 409; readonly error: "reading_required"; readonly reading: string; readonly observationId: string }
  | { readonly ok: false; readonly status: 404 | 409 | 503; readonly error: string };

/**
 * Keep a photo already linked to this notebook as one of its sources.
 * Idempotent: a photo that already has a visible derived source (kept earlier,
 * or confirmed as a nameplate) returns that source and changes nothing.
 * A first keep requires the technician-reviewed reading so a vision misread
 * cannot be stored silently (#4643).
 */
export async function keepPhotoAsSource(opts: {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly notebook: { readonly id: string; readonly nodeId: string; readonly displayName: string };
  readonly fileId: string;
  /** The conversation the technician pressed Keep in: keep the reading they saw there. */
  readonly threadId?: string | null;
  /** The text the technician reviewed (and possibly corrected) in the Keep step. */
  readonly reviewedReading?: string | null;
}): Promise<KeepPhotoResult> {
  const { tenantId, notebook, fileId } = opts;
  // The link is the server's proof the photo was attached to THIS machine; a
  // file id from another notebook or tenant is indistinguishable from none.
  const photo = await photoLinkedToTarget(tenantId, fileId, "equipment_notebook", notebook.id);
  if (!photo) return { ok: false, status: 404, error: "photo_not_found" };

  const existing = await findVisibleOriginSource(tenantId, notebook.id, fileId);
  if (existing) return { ok: true, docId: existing.docId, alreadyKept: true, chunkCount: 0 };

  // The same photo can be read more than once, and readings can disagree. Keep
  // the one from the conversation the technician is looking at; without a
  // conversation (or an owner to scope by) fall back to the latest reading.
  const scope = opts.threadId !== undefined && opts.userId
    ? { notebookId: notebook.id, ownerUserId: opts.userId, threadId: opts.threadId }
    : undefined;
  const reading = await withTenantContext(tenantId, (c) => loadVisualEvidenceForPhoto(c, tenantId, fileId, scope));
  // No stored reading means there is nothing citable to keep. Say so rather
  // than attach an empty document.
  if (!reading || reading.text.trim() === "") return { ok: false, status: 409, error: "no_photo_reading" };

  let screenLines: string[] | null = null;
  try {
    screenLines = await withTenantContext(tenantId, (c) =>
      loadScreenTextLines(c, tenantId, reading.sessionId, fileId),
    );
  } catch {
    screenLines = null;
  }
  const proposed = composePhotoReadingForReview(reading.text, screenLines);
  if (opts.reviewedReading == null) {
    return {
      ok: false,
      status: 409,
      error: "reading_required",
      reading: proposed,
      observationId: reading.observationId,
    };
  }
  const reviewed = opts.reviewedReading.trim().slice(0, MAX_LOOK_CORRECTION_VALUE_CHARS);
  if (!reviewed) return { ok: false, status: 409, error: "no_photo_reading" };

  let observationId = reading.observationId;
  let technicianConfirmed = false;
  if (reviewed !== proposed) {
    const corr = await correctVisualObservations({
      tenantId,
      boundEntityId: null,
      fileId,
      corrections: [{ observationId: reading.observationId, value: reviewed }],
      correctedBy: opts.userId,
    });
    if (corr.corrected.length === 0) {
      return { ok: false, status: 409, error: "correction_not_applied" };
    }
    observationId = corr.corrected[0].replacementId;
    technicianConfirmed = true;
  }

  const text = buildPhotoSourceText({
    machineName: notebook.displayName,
    fileId,
    photoSha256: reading.photoHash,
    capturedAt: photo.capturedAt,
    observation: reviewed,
    technicianConfirmed,
  });
  const day = (photo.capturedAt ?? "").slice(0, 10) || fileId;
  const materialized = await materializeDerivedTextDoc({
    tenantId,
    nodeId: notebook.nodeId,
    // The title rides on every chunk, so the trust state reaches the prompt and
    // the citation even when the header above lands in a different chunk.
    filename: technicianConfirmed
      ? `Technician-confirmed photo reading ${day}.txt`
      : `Unconfirmed photo reading ${day}.txt`,
    text,
    createdBy: opts.userId,
    source: "photo_text",
  });
  if (!materialized.docId) return { ok: false, status: 503, error: "photo_source_in_progress" };

  if (technicianConfirmed) {
    await markNameplateDocVerified(tenantId, materialized.docId);
  }

  const att = await attachSource(tenantId, notebook.id, materialized.docId, {
    matchState: "user_confirmed",
    sourceRole: "photo",
    addedBy: opts.userId,
    originFileId: fileId,
    matchEvidence: { kept_from_observation: observationId },
  });
  if (!att.ok) return { ok: false, status: 503, error: `attach_source_failed:${att.error}` };
  // One photograph, one visible source (085 Invariant 1).
  await supersedePriorOriginSources(tenantId, notebook.id, fileId, materialized.docId).catch(() => []);
  return { ok: true, docId: materialized.docId, alreadyKept: false, chunkCount: materialized.chunkCount };
}
