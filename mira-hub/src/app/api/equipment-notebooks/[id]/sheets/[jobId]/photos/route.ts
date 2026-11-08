/**
 * POST /api/equipment-notebooks/[id]/sheets/[jobId]/photos — attach a
 *      technician photo to an open Living Work Sheet job.
 *
 *      Multipart: `file` (image/*, <=10MB), `clientEventId` (uuid),
 *      `baseSeq` (integer), optional `caption`. Parks the bytes and attaches
 *      them to the notebook via the canonical Files service
 *      (parkOrReuseFile + attachFileToTargets — never /look, /api/files, OCR
 *      or vision, per TASK-S3), then appends a `photo_attached` event
 *      through the S1 store and returns the SAME response shape as the
 *      events route (TASK-S3 §Files).
 *
 *      `photoId` is set to `clientEventId`, not a fresh random id: the S1
 *      store dedupes a retried append on (clientEventId, content
 *      fingerprint) — a fresh photoId on retry would change the fingerprint
 *      and the retry would come back `request_id_conflict` instead of
 *      replaying the original event. `fileId` is already stable (content-
 *      hash dedup in parkOrReuseFile) and `caption` is the same string on
 *      retry, so pinning `photoId` is the only change needed for a clean
 *      replay.
 *
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { appendEvent, livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };
const JOB_NOT_FOUND = { error: "job_not_found" };
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id, jobId } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (!isUuid(jobId)) return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart_form_required" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file_field_required", field: "file" }, { status: 400 });
  if (!file.type || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "unsupported_file_type", field: "file" }, { status: 415 });
  }
  if (file.size === 0) return NextResponse.json({ error: "empty_file", field: "file" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "file_too_large", field: "file" }, { status: 413 });

  const clientEventIdRaw = form.get("clientEventId");
  if (typeof clientEventIdRaw !== "string" || !isUuid(clientEventIdRaw)) {
    return NextResponse.json({ error: "invalid_client_event_id", field: "clientEventId" }, { status: 400 });
  }
  const clientEventId = clientEventIdRaw;

  const baseSeqRaw = form.get("baseSeq");
  const baseSeq = typeof baseSeqRaw === "string" ? Number(baseSeqRaw) : NaN;
  if (!Number.isInteger(baseSeq) || baseSeq < 0) {
    return NextResponse.json({ error: "invalid_base_seq", field: "baseSeq" }, { status: 400 });
  }

  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" && captionRaw.trim().length > 0 ? captionRaw.trim().slice(0, 2000) : null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parked = await parkOrReuseFile({
      tenantId: ctx.tenantId,
      filename: file.name || "photo",
      mimeType: file.type,
      sizeBytes: file.size,
      buffer,
      createdBy: ctx.userId ?? null,
      source: "living_sheet_photo",
    });

    const attached = await attachFileToTargets(ctx.tenantId, parked.fileId, [
      { targetType: "equipment_notebook", targetId: id },
    ]);
    if (!attached.ok) {
      return NextResponse.json({ error: attached.error }, { status: 404 });
    }

    const result = await appendEvent(
      ctx.tenantId,
      id,
      jobId,
      {
        clientEventId,
        baseSeq,
        kind: "photo_attached",
        payload: { photoId: clientEventId, fileId: parked.fileId, caption },
        occurredAt: new Date().toISOString(),
        workOrderId: null,
      },
      { userId: ctx.userId ?? null, label: ctx.email ?? null },
    );

    switch (result.status) {
      case "created":
        return NextResponse.json({ event: result.event, seq: result.seq, view: result.view }, { status: 201 });
      case "existing":
        return NextResponse.json({ event: result.event, replayed: true }, { status: 200 });
      case "request_id_conflict":
        return NextResponse.json(
          { error: "request_id_conflict", message: "That request id was already used for a different event." },
          { status: 409 },
        );
      case "job_not_found":
        return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
      case "invalid_target":
        return NextResponse.json({ error: result.error, ...(result.field ? { field: result.field } : {}) }, { status: 400 });
      case "invalid_base_seq":
        return NextResponse.json({ error: "invalid_base_seq" }, { status: 400 });
      case "conflict":
        return NextResponse.json({ error: "conflict", seq: result.seq, view: result.view }, { status: 409 });
      case "job_finished":
        return NextResponse.json(
          { error: "job_finished", message: "This job is finished. Start a new job to record more.", seq: result.seq, view: result.view },
          { status: 409 },
        );
    }
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}
