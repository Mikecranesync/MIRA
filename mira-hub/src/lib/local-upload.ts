import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createUpload,
  updateUploadStatus,
  type Upload,
  type UploadKind,
} from "@/lib/uploads";
import {
  forwardToIngest,
  forwardToPhotoIngest,
  inferKindFromMime,
  SUPPORTED_MIMES,
} from "@/lib/mira-ingest-client";
import { makeUploadLogger } from "@/lib/upload-log";
import { validateAssetTag } from "@/lib/asset-tag";
import { sniffMime, isMimeCompatible } from "@/lib/sniff-mime";
import {
  saveUploadBuffer,
  readUploadBuffer,
  deleteUploadBuffer,
} from "@/lib/upload-buffer";

export interface UploadAuthContext {
  tenantId: string;
  userId?: string;
}

const MAX = 20 * 1024 * 1024;

function extGuess(nameLower: string): string {
  if (nameLower.endsWith(".pdf")) return "application/pdf";
  if (nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg")) return "image/jpeg";
  if (nameLower.endsWith(".png")) return "image/png";
  if (nameLower.endsWith(".webp")) return "image/webp";
  if (nameLower.endsWith(".heic")) return "image/heic";
  if (nameLower.endsWith(".heif")) return "image/heif";
  return "";
}

export async function handleLocalUpload(
  req: NextRequest,
  ctx: UploadAuthContext,
): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_field_required" }, { status: 400 });
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: "exceeds_20mb_limit", got: file.size }, { status: 400 });
  }

  const nameLower = file.name.toLowerCase();
  const mime = file.type || extGuess(nameLower) || "application/octet-stream";
  if (!SUPPORTED_MIMES.has(mime)) {
    return NextResponse.json(
      { error: "unsupported_mime", got: mime, supported: Array.from(SUPPORTED_MIMES) },
      { status: 400 },
    );
  }

  const assetTagCheck = validateAssetTag(form.get("assetTag"));
  if (!assetTagCheck.ok) {
    return NextResponse.json({ error: assetTagCheck.reason }, { status: 400 });
  }
  const assetTag = assetTagCheck.value;

  const unsPathRaw = (form.get("unsPath") as string | null)?.trim() ?? "";
  const unsPath = unsPathRaw.length > 0 && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(unsPathRaw)
    ? unsPathRaw
    : null;
  if (unsPathRaw.length > 0 && !unsPath) {
    return NextResponse.json({ error: "uns_path_invalid_format" }, { status: 400 });
  }

  const kind = inferKindFromMime(mime);
  const buffer = new Uint8Array(await file.arrayBuffer());

  const sniffed = sniffMime(buffer.subarray(0, 16));
  if (!isMimeCompatible(mime, sniffed)) {
    return NextResponse.json(
      { error: "content_does_not_match_declared_mime", declared: mime, sniffed },
      { status: 400 },
    );
  }

  const upload = await createUpload({
    tenantId: ctx.tenantId,
    provider: "local",
    kind,
    filename: file.name,
    mimeType: mime,
    sizeBytes: file.size,
    externalCreatedAt: new Date(file.lastModified),
    initialStatus: "parsing",
    assetTag,
    unsPath,
  });

  const requestId = req.headers.get("x-request-id") ?? randomUUID();

  // Persist the bytes BEFORE the ingest attempt so a FAILED upload can be
  // retried without the user re-picking the file. Best-effort; deleted on
  // success by runLocalIngest, kept on failure for /api/uploads/:id/retry.
  await saveUploadBuffer(upload.id, buffer);

  // Background ingest. Next.js 16 standalone breaks `after()` with
  // ENVIRONMENT_FALLBACK, so we use a plain fire-and-forget Promise.
  void runLocalIngest({
    uploadId: upload.id,
    tenantId: ctx.tenantId,
    buffer,
    filename: file.name,
    mime,
    kind,
    assetTag,
    requestId,
  });

  return NextResponse.json(upload, { status: 201, headers: { "X-Request-Id": requestId } });
}

interface LocalIngestParams {
  uploadId: string;
  tenantId: string;
  buffer: Uint8Array;
  filename: string;
  mime: string;
  kind: UploadKind;
  assetTag: string | null;
  requestId: string;
}

/**
 * Forward a local upload's bytes to mira-ingest and record the result. Shared
 * by the initial upload and the retry path. On success the persisted buffer is
 * deleted; on failure it is KEPT so the upload can be retried.
 */
async function runLocalIngest(p: LocalIngestParams): Promise<void> {
  const log = makeUploadLogger({
    requestId: p.requestId,
    uploadId: p.uploadId,
    tenantId: p.tenantId,
  });
  log.log("parsing", {
    provider: "local",
    kind: p.kind,
    filename: p.filename,
    mimeType: p.mime,
    sizeBytes: p.buffer.byteLength,
  });
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(p.buffer);
        controller.close();
      },
    });
  try {
    if (p.kind === "photo") {
      const result = await forwardToPhotoIngest(stream(), p.filename, p.mime, {
        assetTag: p.assetTag,
        requestId: p.requestId,
      });
      await updateUploadStatus(p.uploadId, p.tenantId, "parsed", result.description ?? null, {
        kbFileId: result.photoId != null ? String(result.photoId) : undefined,
      });
      log.log("parsed", { photoId: result.photoId, kind: p.kind });
    } else {
      const result = await forwardToIngest(stream(), p.filename, p.mime, {
        requestId: p.requestId,
      });
      await updateUploadStatus(p.uploadId, p.tenantId, "parsed", null, {
        kbFileId: result.fileId ?? undefined,
        kbChunkCount: result.chunkCount ?? undefined,
      });
      log.log("parsed", { kind: p.kind, kbFileId: result.fileId, kbChunkCount: result.chunkCount });
    }
    // Success — reclaim the persisted buffer.
    await deleteUploadBuffer(p.uploadId);
  } catch (err) {
    log.error("failed", err);
    await updateUploadStatus(p.uploadId, p.tenantId, "failed", (err as Error).message).catch(
      (statusErr: unknown) => log.error("status_update_failed", statusErr),
    );
    // Keep the buffer so the upload can be retried from /api/uploads/:id/retry.
  }
}

/**
 * Retry a FAILED local upload from its persisted buffer (#704 follow-up,
 * 2026-06-06). Returns true if the buffer was found and the ingest was
 * re-triggered, false if the buffer is gone (caller must prompt re-upload).
 */
export async function retryLocalUpload(row: Upload, requestId: string): Promise<boolean> {
  const buffer = await readUploadBuffer(row.id);
  if (!buffer) return false;
  await updateUploadStatus(row.id, row.tenantId, "parsing", "retry");
  void runLocalIngest({
    uploadId: row.id,
    tenantId: row.tenantId,
    buffer,
    filename: row.filename,
    mime: row.mimeType ?? "application/pdf",
    kind: row.kind,
    assetTag: row.assetTag,
    requestId,
  });
  return true;
}
