import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  createUpload,
  listUploads,
  updateUploadStatus,
  type UploadProvider,
} from "@/lib/uploads";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import {
  streamFromGoogleDrive,
  streamFromSignedUrl,
} from "@/lib/fetch-adapters";
import { forwardToIngest } from "@/lib/mira-ingest-client";

export const dynamic = "force-dynamic";

interface CreatePayload {
  provider: UploadProvider;
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  externalCreatedAt?: string;
}

export async function POST(req: NextRequest) {
  let body: CreatePayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.provider !== "google" && body.provider !== "dropbox") {
    return NextResponse.json(
      { error: "provider_must_be_google_or_dropbox" },
      { status: 400 },
    );
  }
  if (!body.filename) {
    return NextResponse.json({ error: "filename_required" }, { status: 400 });
  }
  if (body.mimeType && body.mimeType !== "application/pdf") {
    return NextResponse.json(
      { error: "only_pdf_supported", got: body.mimeType },
      { status: 400 },
    );
  }
  const MAX = 20 * 1024 * 1024;
  if (body.sizeBytes != null && body.sizeBytes > MAX) {
    return NextResponse.json(
      { error: "exceeds_20mb_limit", got: body.sizeBytes },
      { status: 400 },
    );
  }
  if (body.provider === "google" && !body.externalFileId) {
    return NextResponse.json({ error: "externalFileId_required_for_google" }, { status: 400 });
  }
  if (body.provider === "dropbox" && !body.externalDownloadUrl) {
    return NextResponse.json(
      { error: "externalDownloadUrl_required_for_dropbox" },
      { status: 400 },
    );
  }

  const upload = await createUpload({
    provider: body.provider,
    externalFileId: body.externalFileId ?? null,
    externalDownloadUrl: body.externalDownloadUrl ?? null,
    filename: body.filename,
    mimeType: body.mimeType ?? "application/pdf",
    sizeBytes: body.sizeBytes ?? null,
    externalCreatedAt: body.externalCreatedAt ?? null,
    initialStatus: "queued",
  });

  after(() => runIngestPipeline(upload.id, body));

  return NextResponse.json(upload, { status: 201 });
}

export async function GET() {
  const rows = await listUploads();
  return NextResponse.json(rows);
}

async function runIngestPipeline(uploadId: string, payload: CreatePayload): Promise<void> {
  try {
    await updateUploadStatus(uploadId, "fetching");
    let fetched;
    if (payload.provider === "google") {
      const { accessToken } = await ensureFreshAccessToken("google");
      fetched = await streamFromGoogleDrive(payload.externalFileId!, accessToken);
    } else {
      fetched = await streamFromSignedUrl(payload.externalDownloadUrl!);
    }

    await updateUploadStatus(uploadId, "parsing");
    const result = await forwardToIngest(
      fetched.stream,
      payload.filename,
      payload.mimeType ?? fetched.contentType,
    );
    await updateUploadStatus(uploadId, "parsed", null, {
      kbFileId: result.fileId ?? undefined,
      kbChunkCount: result.chunkCount ?? undefined,
    });
  } catch (err) {
    console.error(`[uploads/${uploadId}] pipeline failed`, err);
    await updateUploadStatus(uploadId, "failed", (err as Error).message);
  }
}
