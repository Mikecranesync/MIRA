import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import {
  forwardToIngest,
  forwardToPhotoIngest,
  inferKindFromMime,
  SUPPORTED_MIMES,
} from "@/lib/mira-ingest-client";
import { sessionOr401 } from "@/lib/session";

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

  after(async () => {
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
        });
        await updateUploadStatus(upload.id, "parsed", result.description ?? null, {
          kbFileId: result.photoId != null ? String(result.photoId) : undefined,
        });
      } else {
        const result = await forwardToIngest(stream(), file.name, mime);
        await updateUploadStatus(upload.id, "parsed", null, {
          kbFileId: result.fileId ?? undefined,
          kbChunkCount: result.chunkCount ?? undefined,
        });
      }
    } catch (err) {
      console.error(`[uploads/local/${upload.id}] failed`, err);
      await updateUploadStatus(upload.id, "failed", (err as Error).message);
    }
  });

  return NextResponse.json(upload, { status: 201 });
}
