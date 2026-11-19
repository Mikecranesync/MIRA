import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { normalizeNotebookThreadId } from "@/lib/equipment-notebooks";
import { WORKFLOW_UUID } from "@/lib/workflow-contract";
import { inspectManualQuestion } from "@/capabilities/manual-workflow-store";

export const dynamic = "force-dynamic";

/** Reference-only read: no retries, mutation, inference or recency update. */
export async function GET(req: Request) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const query = new URL(req.url).searchParams;
  const notebookId = (query.get("notebook_id") ?? "").toLowerCase();
  const fileId = (query.get("file_id") ?? "").toLowerCase();
  const clientRequestId = query.get("client_request_id")?.toLowerCase();
  const thread = query.get("thread_id");
  const threadId = thread === null ? undefined : normalizeNotebookThreadId(thread);
  if (!WORKFLOW_UUID.test(notebookId) || !WORKFLOW_UUID.test(fileId) ||
      (clientRequestId !== undefined && !WORKFLOW_UUID.test(clientRequestId)) || threadId === null) {
    return NextResponse.json({ error: "invalid_workflow_scope" }, { status: 400 });
  }
  try {
    const result = await inspectManualQuestion({ tenantId: ctx.tenantId, userId: ctx.userId, notebookId, fileId,
      clientRequestId, ...(threadId ? { threadId } : {}) });
    return NextResponse.json(result ?? { error: "workflow_not_found" }, { status: result ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "workflow_inspection_unavailable" }, { status: 503 });
  }
}
