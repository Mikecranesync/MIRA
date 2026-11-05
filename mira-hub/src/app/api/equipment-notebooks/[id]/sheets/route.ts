/**
 * GET  /api/equipment-notebooks/[id]/sheets — list this notebook's Living
 *      Work Sheet jobs (jobId, title, startedAt, startedBy, finished, seq).
 *      Reads are allowed even when the notebook's machine binding isn't
 *      confirmed (TASK-S1 §Routes).
 * POST /api/equipment-notebooks/[id]/sheets — start a job on the notebook's
 *      CURRENT confirmed machine. 409 if unbound/unconfirmed.
 *
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404. See
 * capabilities/living-sheet/store.ts for the write and
 * db/migrations/114_living_work_sheet.sql for the schema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, resolveBoundAsset } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { confirmedAssetOf } from "@/capabilities/observations/gate";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { validateStartJobInput } from "@/capabilities/living-sheet/validate";
import { listJobs, livingSheetStorageUnavailable, startJob } from "@/capabilities/living-sheet/store";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  try {
    const jobs = await listJobs(ctx.tenantId, id);
    return NextResponse.json({ jobs });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });

  const asset = confirmedAssetOf(await resolveBoundAsset(ctx.tenantId, id));
  if (!asset.ok) return asset.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const validated = validateStartJobInput(body, { now: new Date() });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error, ...(validated.field ? { field: validated.field } : {}) }, { status: 400 });
  }

  let result;
  try {
    result = await startJob(
      ctx.tenantId,
      id,
      { entityId: asset.asset.entityId, name: asset.asset.name },
      validated.value,
      { userId: ctx.userId ?? null, label: ctx.email ?? null },
    );
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }

  switch (result.status) {
    case "created":
      return NextResponse.json({ jobId: result.jobId, event: result.event, seq: result.seq, view: result.view }, { status: 201 });
    case "existing":
      return NextResponse.json({ jobId: result.jobId, view: result.view, replayed: true }, { status: 200 });
    case "request_id_conflict":
      return NextResponse.json(
        { error: "request_id_conflict", message: "That request id was already used for a different job." },
        { status: 409 },
      );
    case "template_revision_not_found":
      return NextResponse.json({ error: "template_revision_not_found" }, { status: 404 });
  }
}
