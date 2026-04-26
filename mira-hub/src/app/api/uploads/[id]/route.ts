import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getUpload, updateUploadStatus, deleteUpload } from "@/lib/uploads";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";

export const dynamic = "force-dynamic";

const TERMINAL: ReadonlyArray<string> = ["parsed", "failed", "cancelled"];

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const row = await getUpload(id, ctx.tenantId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const log = makeUploadLogger({ requestId, uploadId: id, tenantId: ctx.tenantId });

  if (!TERMINAL.includes(row.status)) {
    await updateUploadStatus(id, ctx.tenantId, "cancelled", "user cancelled");
    log.log("cancelled", { previousStatus: row.status });
    return NextResponse.json({ ok: true, action: "cancelled" }, { headers: { "X-Request-Id": requestId } });
  }

  if (row.status === "parsed" && row.kbFileId) {
    try {
      await deleteFromOpenWebUi(row.kbFileId);
    } catch (err) {
      log.error("openwebui_delete_failed", err, { kbFileId: row.kbFileId });
    }
  }

  await deleteUpload(id, ctx.tenantId);
  log.log("deleted", { previousStatus: row.status });
  return NextResponse.json({ ok: true, action: "deleted" }, { headers: { "X-Request-Id": requestId } });
}

async function deleteFromOpenWebUi(fileId: string): Promise<void> {
  const base = process.env.OPENWEBUI_BASE_URL;
  const apiKey = process.env.OPENWEBUI_API_KEY;
  if (!base || !apiKey) return;
  const res = await fetch(`${base}/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`openwebui delete ${res.status}`);
  }
}
