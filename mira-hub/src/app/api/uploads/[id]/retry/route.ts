import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { claimUploadForRequeue, getUpload } from "@/lib/uploads";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";
import { pipelineInputFromRow, runIngestPipeline } from "@/lib/upload-pipeline";
import { retryLocalUpload } from "@/lib/local-upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/:id/retry — re-trigger the ingest pipeline for a failed
 * upload (#704). Cloud-source uploads re-fetch from the provider. Local uploads
 * retry from the persisted buffer (2026-06-06); only if that buffer has been
 * swept/lost do we fall back to asking the user to re-upload from disk.
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

  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const log = makeUploadLogger({ requestId, uploadId: id, tenantId: ctx.tenantId });

  if (row.provider === "local") {
    // Retry from the persisted buffer. Only if it's gone (swept after the
    // 7-day window, or predates this feature) do we ask for a fresh upload.
    const retried = await retryLocalUpload(row, requestId);
    if (!retried) {
      return NextResponse.json(
        {
          error: "local_retry_requires_re_upload",
          hint: "the saved file buffer has expired — pick the file again on /hub/upload",
        },
        { status: 400 },
      );
    }
    log.log("retry_queued", { provider: "local", previousDetail: row.statusDetail });
    const refreshedLocal = await getUpload(id, ctx.tenantId);
    return NextResponse.json(refreshedLocal ?? row, {
      status: 202,
      headers: { "X-Request-Id": requestId },
    });
  }

  log.log("retry_queued", {
    provider: row.provider,
    previousDetail: row.statusDetail,
  });

  // Reset the row to queued before the pipeline picks it up so listUploads
  // can show the in-flight UI immediately. The pipeline will move it
  // through fetching → parsing → parsed/failed.
  // The status check above and this transition are ONE statement here, shared
  // with the re-pick path (#4081): only one caller can move a failed row to
  // queued, so two requests can't both start a pipeline for it.
  const claimed = await claimUploadForRequeue(id, ctx.tenantId, ["failed"], "user retry");
  if (!claimed) {
    const current = await getUpload(id, ctx.tenantId);
    return NextResponse.json(
      { error: "upload_not_in_failed_state", currentStatus: current?.status ?? "deleted" },
      { status: 409 },
    );
  }

  void runIngestPipeline(pipelineInputFromRow(claimed, requestId));

  // Return the row in its new "queued" state so the client can update
  // the list optimistically.
  return NextResponse.json(claimed, {
    status: 202,
    headers: { "X-Request-Id": requestId },
  });
}
