import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getUpload, updateUploadStatus } from "@/lib/uploads";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";
import { pipelineInputFromRow, runIngestPipeline } from "@/lib/upload-pipeline";

export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/:id/retry — re-trigger the ingest pipeline for a failed
 * cloud-source upload (#704). Local uploads return 400 because the original
 * file buffer was discarded after the first attempt; UI must prompt the
 * user to re-upload from disk.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const row = await getUpload(id, ctx.tenantId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (row.status !== "failed") {
    return NextResponse.json(
      { error: "upload_not_in_failed_state", currentStatus: row.status },
      { status: 409 },
    );
  }

  if (row.provider === "local") {
    return NextResponse.json(
      {
        error: "local_retry_requires_re_upload",
        hint: "the original file buffer is gone — pick the file again on /hub/upload",
      },
      { status: 400 },
    );
  }

  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const log = makeUploadLogger({ requestId, uploadId: id, tenantId: ctx.tenantId });
  log.log("retry_queued", {
    provider: row.provider,
    previousDetail: row.statusDetail,
  });

  // Reset the row to queued before the pipeline picks it up so listUploads
  // can show the in-flight UI immediately. The pipeline will move it
  // through fetching → parsing → parsed/failed.
  await updateUploadStatus(id, ctx.tenantId, "queued", "user retry");

  void runIngestPipeline(pipelineInputFromRow(row, requestId));

  // Return the row in its new "queued" state so the client can update
  // the list optimistically.
  const refreshed = await getUpload(id, ctx.tenantId);
  return NextResponse.json(refreshed ?? row, {
    status: 202,
    headers: { "X-Request-Id": requestId },
  });
}
