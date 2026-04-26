import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import {
  forwardToIngest,
  forwardToPhotoIngest,
  inferKindFromMime,
  SUPPORTED_MIMES,
} from "@/lib/mira-ingest-client";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";

export const dynamic = "force-dynamic";

const MAX = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
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
  const extGuess =
    nameLower.endsWith(".pdf") ? "application/pdf" :
    nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg") ? "image/jpeg" :
    nameLower.endsWith(".png") ? "image/png" :
    nameLower.endsWith(".webp") ? "image/webp" :
    nameLower.endsWith(".heic") ? "image/heic" :
    nameLower.endsWith(".heif") ? "image/heif" :
    "";
  const mime = file.type || extGuess || "application/octet-stream";
  if (!SUPPORTED_MIMES.has(mime)) {
    return NextResponse.json(
      {
        error: "unsupported_mime",
        got: mime,
        supported: Array.from(SUPPORTED_MIMES),
      },
      { status: 400 },
    );
  }

  const assetTagRaw = form.get("assetTag");
  const assetTag =
    typeof assetTagRaw === "string" && assetTagRaw.trim().length > 0
      ? assetTagRaw.trim()
      : null;
  const kind = inferKindFromMime(mime);
  const buffer = new Uint8Array(await file.arrayBuffer());

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
  });

  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const log = makeUploadLogger({ requestId, uploadId: upload.id, tenantId: ctx.tenantId });
  log.log("parsing", {
    provider: "local",
    kind,
    filename: file.name,
    mimeType: mime,
    sizeBytes: file.size,
  });

  // Background ingest. Used to be wrapped in `after()` from "next/server",
  // but Next.js 16 standalone throws `Error: ENVIRONMENT_FALLBACK` and the
  // callback never runs — so the upload row stayed at status="parsing"
  // forever and the UI spun. mira-hub runs as a long-lived standalone
  // server (worker isn't killed after each request), so a plain
  // fire-and-forget Promise stays alive until it resolves.
  void (async () => {
    try {
      const stream = () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(buffer);
            controller.close();
          },
        });
      if (kind === "photo") {
        const result = await forwardToPhotoIngest(stream(), file.name, mime, {
          assetTag,
          requestId,
        });
        await updateUploadStatus(upload.id, ctx.tenantId, "parsed", result.description ?? null, {
          kbFileId: result.photoId != null ? String(result.photoId) : undefined,
        });
        log.log("parsed", { photoId: result.photoId, kind });
      } else {
        const result = await forwardToIngest(stream(), file.name, mime, { requestId });
        await updateUploadStatus(upload.id, ctx.tenantId, "parsed", null, {
          kbFileId: result.fileId ?? undefined,
          kbChunkCount: result.chunkCount ?? undefined,
        });
        log.log("parsed", { kind, kbFileId: result.fileId, kbChunkCount: result.chunkCount });
      }
    } catch (err) {
      log.error("failed", err);
      await updateUploadStatus(upload.id, ctx.tenantId, "failed", (err as Error).message).catch(
        (statusErr) => log.error("status_update_failed", statusErr),
      );
    }
  })();

  return NextResponse.json(upload, { status: 201, headers: { "X-Request-Id": requestId } });
}
