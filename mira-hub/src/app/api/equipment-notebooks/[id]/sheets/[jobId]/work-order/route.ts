/**
 * /api/equipment-notebooks/[id]/sheets/[jobId]/work-order
 *
 * POST — the technician explicitly confirms "create a work order in the
 *        CMMS for this sheet". Body must be `{ "confirm": true }`; nothing
 *        is ever requested implicitly. Enqueues ONE `work_order_requested`
 *        event through the cmms-dispatch outbox; a double tap or a retried
 *        POST returns the first request (200, `replayed: true`), never a
 *        second order. Delivery happens later, on a dispatcher tick, and only
 *        when the tenant's `workOrderRequested` policy is on — the response
 *        says so (`delivery.reason`) instead of pretending it was sent.
 * GET  — current delivery status of that request, or `{ request: null }`.
 *
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { livingSheetStorageUnavailable, requestWorkOrder } from "@/capabilities/living-sheet/store";
import { deliveryStatusForWorkOrderRequest } from "@/capabilities/cmms-dispatch";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "notebook_not_found" };
const JOB_NOT_FOUND = { error: "job_not_found" };

type Params = { params: Promise<{ id: string; jobId: string }> };

async function resolve(params: Params["params"]) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });
  const { id, jobId } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (!isUuid(jobId)) return NextResponse.json(JOB_NOT_FOUND, { status: 404 });
  const notebook = await getNotebook(ctx.tenantId, id);
  if (!notebook) return NextResponse.json(NOT_FOUND, { status: 404 });
  return { ctx, id, jobId };
}

export async function POST(req: NextRequest, { params }: Params) {
  const r = await resolve(params);
  if (r instanceof NextResponse) return r;
  const { ctx, id, jobId } = r;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== true) {
    return NextResponse.json({ error: "confirmation_required", field: "confirm" }, { status: 400 });
  }

  let result;
  try {
    result = await requestWorkOrder(ctx.tenantId, id, jobId, { userId: ctx.userId ?? null, label: ctx.email ?? null });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
  if (result.status === "job_not_found") return NextResponse.json(JOB_NOT_FOUND, { status: 404 });

  const { eventId, replayed, delivery } = result.result;
  return NextResponse.json({ eventId, replayed, delivery }, { status: replayed ? 200 : 202 });
}

export async function GET(_req: NextRequest, { params }: Params) {
  const r = await resolve(params);
  if (r instanceof NextResponse) return r;
  let request;
  try {
    request = await deliveryStatusForWorkOrderRequest(r.ctx.tenantId, r.jobId);
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
  return NextResponse.json({ request });
}
