/**
 * GET /api/equipment-notebooks/[id]/sheets/[jobId] — `{ view, seq }`, the
 *     job's current reduced sheet. `?atSeq=N` reduces only events with
 *     seq <= N and returns `{ view, seq: N, snapshot: true }` instead — the
 *     same reduce, over a prefix of the same log (reduce.ts is pure, so this
 *     is deterministic). Read-only: no asset-confirmation check (TASK-S1
 *     §Routes — reads are allowed even on an unconfirmed/unbound notebook).
 *
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { loadJob, livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };
const JOB_NOT_FOUND = { error: "job_not_found" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id, jobId } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (!isUuid(jobId)) return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  const atSeqRaw = req.nextUrl.searchParams.get("atSeq");
  let atSeq: number | undefined;
  if (atSeqRaw !== null) {
    const n = Number(atSeqRaw);
    if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: "invalid_at_seq" }, { status: 400 });
    atSeq = n;
  }

  try {
    const result = await loadJob(ctx.tenantId, id, jobId, atSeq);
    if (result.status === "job_not_found") return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
    return atSeq === undefined
      ? NextResponse.json({ view: result.view, seq: result.view.seq })
      : NextResponse.json({ view: result.view, seq: atSeq, snapshot: true });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}
