import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getUpload, getUploadCounts, updateUploadStatus, deleteUpload } from "@/lib/uploads";
import { sessionOr401 } from "@/lib/session";
import { makeUploadLogger } from "@/lib/upload-log";
import { composeTimeout, isAbortError } from "@/lib/abort-helpers";

const OPENWEBUI_DELETE_TIMEOUT_MS = 10_000;

export const dynamic = "force-dynamic";

const TERMINAL: ReadonlyArray<string> = ["parsed", "failed", "cancelled"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dual-mode auth helper. Returns the tenantId to scope queries against, or a
 * NextResponse to short-circuit. The bearer path is used by
 * tools/mira-drop-watcher to poll upload status without a browser session.
 */
async function resolveTenant(req: NextRequest): Promise<string | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.HUB_INGEST_TOKEN ?? "";
  if (bearer && expected && bearer === expected) {
    const headerTenant = (req.headers.get("x-mira-tenant-id") ?? "").trim();
    if (!UUID_RE.test(headerTenant)) {
      return NextResponse.json(
        { error: "x_mira_tenant_id_required" },
        { status: 400 },
      );
    }
    return headerTenant;
  }
  const sess = await sessionOr401();
  if (sess instanceof NextResponse) return sess;
  return sess.tenantId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await resolveTenant(req);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;
  const row = await getUpload(id, tenantId);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Counts are only meaningful once the pipeline has finished (or failed).
  // For in-flight uploads we return zeros so the card shows "Processing…".
  const counts =
    row.status === "parsed"
      ? await getUploadCounts(row, tenantId)
      : { pm_tasks_count: 0, fault_codes_count: 0, knowledge_chunks_count: 0 };

  return NextResponse.json({ ...row, ...counts });
}

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
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: composeTimeout(undefined, OPENWEBUI_DELETE_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) throw new Error(`timeout: openwebui delete (${OPENWEBUI_DELETE_TIMEOUT_MS}ms)`);
    throw err;
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`openwebui delete ${res.status}`);
  }
}
