/**
 * POST /api/equipment-notebooks/[id]/send-wait — should this question wait for the project's
 * manual lookup? (#5746 round 6 F1)
 *
 * The detail read decides from saved questions only. A question that names the project's own
 * model, sent in a thread that earlier asked about another model, would then be sent before the
 * manual is ready. This check reads the same saved history the detail read does, as the same
 * viewer, and adds the question about to be sent as the newest whole-machine question, so one
 * subject rule decides (`send-wait-subject.ts`). The model matcher is server-only, which is why
 * this is a request and not a client function.
 *
 * Body: `{ threadId, question }`. The question travels in the body, never the URL.
 * Response: `{ lookup }`, the lookup to wait for (no message or link), or null to send now.
 * Read-only: nothing is saved, and any failure is a 503 the Hub treats as "send now".
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns, normalizeNotebookThreadId } from "@/lib/equipment-notebooks";
import {
  TURN_WINDOW,
  notebookManualStatus,
  sendWaitAllows,
  sendWaitStatus,
  subjectMachine,
  subjectReader,
} from "@/capabilities/send-wait-subject";

export const dynamic = "force-dynamic";

/** Longer than any composer question; a cap, not a contract. */
const MAX_QUESTION_LENGTH = 8_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let body: { threadId?: unknown; question?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const threadId = normalizeNotebookThreadId(body?.threadId);
  if (!threadId) return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "invalid_question" }, { status: 400 });
  }
  try {
    const notebook = await getNotebook(ctx.tenantId, id);
    if (!notebook) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [sources, turns] = await Promise.all([
      listSources(ctx.tenantId, id),
      // The same viewer-scoped history the detail read uses: own turns plus labeled legacy rows.
      listTurns(ctx.tenantId, id, TURN_WINDOW, { viewerUserId: ctx.userId, threadId }),
    ]);
    const status = await notebookManualStatus(ctx.tenantId, id, notebook, sources, turns);
    const machine = status ? subjectMachine(status, notebook) : null;
    if (!status || !machine) return NextResponse.json({ lookup: null });
    const subject = subjectReader({ tenantId: ctx.tenantId, notebookId: id, viewerUserId: ctx.userId, threadId, turns, machine });
    const scope = await subject.wholeMachine(question);
    return NextResponse.json({ lookup: sendWaitAllows(scope) ? sendWaitStatus(status) : null });
  } catch (err) {
    console.error("[equipment-notebooks] send-wait check failed (the Hub sends without waiting):", err);
    return NextResponse.json({ error: "send_wait_unavailable" }, { status: 503 });
  }
}
