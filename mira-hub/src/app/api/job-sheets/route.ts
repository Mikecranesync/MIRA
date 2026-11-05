/**
 * GET  /api/job-sheets — list reusable job sheet templates for this tenant
 *      (latest revision + latest reviewed revision per sheet).
 * POST /api/job-sheets — create a new job sheet: a `job_sheets` row plus
 *      its first revision (1, draft).
 *
 * Job sheet templates are part of the Living Work Sheet capability
 * (TASK-S4) and share its flag. Unlike `work_sheet_events`, templates are
 * NOT scoped to a notebook — they're a tenant-wide library.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { createJobSheet, listJobSheets } from "@/capabilities/living-sheet/job-sheet-store";

const DISABLED = { error: "living_sheet_disabled" };

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  try {
    const jobSheets = await listJobSheets(ctx.tenantId);
    return NextResponse.json({ jobSheets });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { clientRequestId, body } = raw as { clientRequestId?: unknown; body?: unknown };
  if (typeof clientRequestId !== "string" || !isUuid(clientRequestId)) {
    return NextResponse.json({ error: "invalid_client_request_id", field: "clientRequestId" }, { status: 400 });
  }

  let result;
  try {
    result = await createJobSheet(ctx.tenantId, { clientRequestId, body }, { userId: ctx.userId ?? null, label: ctx.email ?? null });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }

  switch (result.status) {
    case "created":
      return NextResponse.json({ jobSheetId: result.jobSheetId, revision: result.revision }, { status: 201 });
    case "existing":
      return NextResponse.json({ jobSheetId: result.jobSheetId, revision: result.revision, replayed: true }, { status: 200 });
    case "request_id_conflict":
      return NextResponse.json(
        { error: "request_id_conflict", message: "That request id was already used for a different job sheet." },
        { status: 409 },
      );
    case "invalid_body":
      return NextResponse.json({ error: result.error, ...(result.field ? { field: result.field } : {}) }, { status: 400 });
  }
}
