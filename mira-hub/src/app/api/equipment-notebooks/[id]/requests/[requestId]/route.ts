import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { LEGACY_THREAD_ID, normalizeNotebookThreadId } from "@/lib/equipment-notebooks";
import { readTurnRecovery } from "@/capabilities/turn-recovery/store";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const actor = await sessionOr401({ requireCurrentUser: true });
  if (actor instanceof NextResponse) {
    for (const [key, value] of Object.entries(headers)) actor.headers.set(key, value);
    return actor;
  }
  const { id, requestId } = await params;
  const query = new URL(request.url).searchParams;
  if (!UUID.test(id) || !UUID.test(requestId) || [...query.keys()].some((key) => key !== "threadId") || query.getAll("threadId").length > 1) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });
  }
  const rawThread = query.get("threadId");
  const thread = rawThread === null ? LEGACY_THREAD_ID : normalizeNotebookThreadId(rawThread);
  if (!thread) return NextResponse.json({ error: "invalid_thread_id" }, { status: 400, headers });
  const recovery = await readTurnRecovery(actor.tenantId, id, actor.userId, thread === LEGACY_THREAD_ID ? null : thread, requestId, request.signal);
  return recovery
    ? NextResponse.json(recovery, { headers })
    : NextResponse.json({ error: "not_found" }, { status: 404, headers });
}
