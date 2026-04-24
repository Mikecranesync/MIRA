import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createUpload, updateUploadStatus } from "@/lib/uploads";
import { forwardToIngest } from "@/lib/mira-ingest-client";

export const dynamic = "force-dynamic";

const MAX = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_field_required" }, { status: 400 });
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: "exceeds_20mb_limit", got: file.size }, { status: 400 });
  }
  const mime = file.type || "application/pdf";
  if (mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "only_pdf_supported", got: mime }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());

  const upload = await createUpload({
    provider: "local",
    filename: file.name,
    mimeType: mime,
    sizeBytes: file.size,
    externalCreatedAt: new Date(file.lastModified),
    initialStatus: "parsing",
  });

  after(async () => {
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buffer);
          controller.close();
        },
      });
      const result = await forwardToIngest(stream, file.name, mime);
      await updateUploadStatus(upload.id, "parsed", null, {
        kbFileId: result.fileId ?? undefined,
        kbChunkCount: result.chunkCount ?? undefined,
      });
    } catch (err) {
      console.error(`[uploads/local/${upload.id}] failed`, err);
      await updateUploadStatus(upload.id, "failed", (err as Error).message);
    }
  });

  return NextResponse.json(upload, { status: 201 });
}
