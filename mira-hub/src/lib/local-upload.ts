import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import {
  forwardToIngest,
  forwardToPhotoIngest,
  inferKindFromMime,
  SUPPORTED_MIMES,
} from "@/lib/mira-ingest-client";
import { makeUploadLogger } from "@/lib/upload-log";
import { validateAssetTag } from "@/lib/asset-tag";
import { sniffMime, isMimeCompatible } from "@/lib/sniff-mime";

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
  const log = makeUploadLogger({ requestId, uploadId: upload.id, tenantId: ctx.tenantId });
  log.log("parsing", {
    provider: "local",
    kind,
    filename: file.name,
    mimeType: mime,
    sizeBytes: file.size,
  });

  // Background ingest. Next.js 16 standalone breaks `after()` with
  // ENVIRONMENT_FALLBACK, so we use a plain fire-and-forget Promise.
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
        (statusErr: unknown) => log.error("status_update_failed", statusErr),
      );
    }
  })();

  return NextResponse.json(upload, { status: 201, headers: { "X-Request-Id": requestId } });
}
