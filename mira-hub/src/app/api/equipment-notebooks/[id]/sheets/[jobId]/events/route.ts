/**
 * POST /api/equipment-notebooks/[id]/sheets/[jobId]/events — append one
 *      Living Work Sheet event to the job's log. The actor always comes
 *      from the session (ctx.userId / ctx.email), never from the request
 *      body (TASK-S1 §Routes). No asset-confirmation check here — only
 *      starting a job requires a confirmed machine; appending to one that
 *      already started does not re-check the binding.
 *
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { validateAppendEventInput } from "@/capabilities/living-sheet/validate";
import { appendEvent, livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };
const JOB_NOT_FOUND = { error: "job_not_found" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id, jobId } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (!isUuid(jobId)) return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const validated = validateAppendEventInput(body, { now: new Date() });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, ...(validated.field ? { field: validated.field } : {}) }, { status: 400 });
  }

  let result;
  try {
    result = await appendEvent(ctx.tenantId, id, jobId, validated.value, { userId: ctx.userId ?? null, label: ctx.email ?? null });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }

  switch (result.status) {
    case "created":
      return NextResponse.json({ event: result.event, seq: result.seq, view: result.view }, { status: 201 });
    case "existing":
      return NextResponse.json({ event: result.event, replayed: true }, { status: 200 });
    case "request_id_conflict":
      return NextResponse.json(
        { error: "request_id_conflict", message: "That request id was already used for a different event." },
        { status: 409 },
      );
    case "job_not_found":
      return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
    case "invalid_target":
      return NextResponse.json({ error: result.error, ...(result.field ? { field: result.field } : {}) }, { status: 400 });
    case "invalid_base_seq":
      return NextResponse.json({ error: "invalid_base_seq" }, { status: 400 });
    case "conflict":
      return NextResponse.json({ error: "conflict", seq: result.seq, view: result.view }, { status: 409 });
    case "job_finished":
      return NextResponse.json(
        { error: "job_finished", message: "This job is finished. Start a new job to record more.", seq: result.seq, view: result.view },
        { status: 409 },
      );
  }
}
