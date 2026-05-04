import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createUpload,
  findUploadByExternalFileId,
  listUploads,
  type Upload,
  type UploadProvider,
} from "@/lib/uploads";
import {
  inferKindFromMime,
  SUPPORTED_MIMES,
} from "@/lib/mira-ingest-client";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";
import { validateAssetTag } from "@/lib/asset-tag";
import { runIngestPipeline } from "@/lib/upload-pipeline";

export const dynamic = "force-dynamic";

interface CreatePayload {
  provider: UploadProvider;
  externalFileId?: string;
  externalDownloadUrl?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  externalCreatedAt?: string;
  assetTag?: string;
}

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
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
  const mime = body.mimeType ?? "application/pdf";
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

  const assetTagCheck = validateAssetTag(body.assetTag);
  if (!assetTagCheck.ok) {
    return NextResponse.json({ error: assetTagCheck.reason }, { status: 400 });
  }
  const assetTag = assetTagCheck.value;

  const kind = inferKindFromMime(mime);
  const requestId = req.headers.get("x-request-id") ?? randomUUID();

  // Idempotency: re-picking the same Drive/Dropbox file should return the
  // existing row, not duplicate the entire fetch → forward → KB pipeline.
  // body.externalFileId is required for both google + dropbox per the
  // validation above.
  if (body.externalFileId) {
    const existing = await findUploadByExternalFileId(
      ctx.tenantId,
      body.provider,
      body.externalFileId,
    );
    if (existing) {
      return idempotentResponse(existing, requestId);
    }
  }

  let upload: Upload;
  try {
    upload = await createUpload({
      tenantId: ctx.tenantId,
      provider: body.provider,
      kind,
      externalFileId: body.externalFileId ?? null,
      externalDownloadUrl: body.externalDownloadUrl ?? null,
      filename: body.filename,
      mimeType: mime,
      sizeBytes: body.sizeBytes ?? null,
      externalCreatedAt: body.externalCreatedAt ?? null,
      initialStatus: "queued",
      assetTag,
    });
  } catch (err) {
    // Race fallback: another request beat us to the unique index between
    // the pre-flight findUploadByExternalFileId() and the INSERT.
    if (isUniqueViolation(err) && body.externalFileId) {
      const existing = await findUploadByExternalFileId(
        ctx.tenantId,
        body.provider,
        body.externalFileId,
      );
      if (existing) return idempotentResponse(existing, requestId);
    }
    throw err;
  }

  const log = makeUploadLogger({ requestId, uploadId: upload.id, tenantId: ctx.tenantId });
  log.log("queued", {
    provider: body.provider,
    kind,
    filename: body.filename,
    mimeType: mime,
    sizeBytes: body.sizeBytes ?? null,
  });

  void runIngestPipeline({
    uploadId: upload.id,
    tenantId: ctx.tenantId,
    requestId,
    provider: body.provider,
    externalFileId: body.externalFileId ?? null,
    externalDownloadUrl: body.externalDownloadUrl ?? null,
    filename: body.filename,
    mimeType: mime,
    kind,
    assetTag,
  });

  return NextResponse.json(upload, { status: 201, headers: { "X-Request-Id": requestId } });
}

const IN_FLIGHT_STATUSES: ReadonlyArray<string> = ["queued", "fetching", "parsing"];

function isUniqueViolation(err: unknown): boolean {
  // pg's UniqueViolation has SQLSTATE 23505
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

function idempotentResponse(existing: Upload, requestId: string): NextResponse {
  if (existing.status === "parsed") {
    return NextResponse.json(
      { ...existing, alreadyImported: true },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  }
  if (IN_FLIGHT_STATUSES.includes(existing.status)) {
    return NextResponse.json(
      { ...existing, alreadyInProgress: true },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  }
  // failed or cancelled — caller should DELETE first to retry
  return NextResponse.json(
    {
      error: "previous_upload_terminal",
      status: existing.status,
      hint: "DELETE /hub/api/uploads/:id then re-upload",
      existing,
    },
    { status: 409, headers: { "X-Request-Id": requestId } },
  );
}

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const rows = await listUploads(ctx.tenantId);
  return NextResponse.json(rows);
}

