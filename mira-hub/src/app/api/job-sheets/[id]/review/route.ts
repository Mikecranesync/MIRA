/**
 * POST /api/job-sheets/[id]/review — mark a job sheet revision reviewed.
 *      Writes a NEW revision row copying the named `revision`'s body with
 *      status='reviewed', reviewed_by = actor label, reviewed_at = now.
 *      The source revision is never edited — "review" is always a new row.
 *
 * Body: { clientRequestId: string (uuid), revision: number }.
 * Flag `NOTEBOOK_LIVING_SHEET` off ⇒ 404.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { isUuid } from "@/capabilities/fix-records";
import { livingSheetEnabled } from "@/capabilities/living-sheet/flag";
import { livingSheetStorageUnavailable } from "@/capabilities/living-sheet/store";
import { reviewJobSheet } from "@/capabilities/living-sheet/job-sheet-store";

const DISABLED = { error: "living_sheet_disabled" };
const NOT_FOUND = { error: "job_sheet_not_found" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!livingSheetEnabled()) return NextResponse.json(DISABLED, { status: 404 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { clientRequestId, revision } = raw as { clientRequestId?: unknown; revision?: unknown };
  if (typeof clientRequestId !== "string" || !isUuid(clientRequestId)) {
    return NextResponse.json({ error: "invalid_client_request_id", field: "clientRequestId" }, { status: 400 });
  }
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return NextResponse.json({ error: "invalid_revision", field: "revision" }, { status: 400 });
  }

  let result;
  try {
    result = await reviewJobSheet(ctx.tenantId, id, { clientRequestId, revision }, { userId: ctx.userId ?? null, label: ctx.email ?? null });
  } catch (err) {
    const unavailable = livingSheetStorageUnavailable(err);
    if (unavailable) return unavailable;
    throw err;
  }

  switch (result.status) {
    case "created":
      return NextResponse.json({ revision: result.revision }, { status: 201 });
    case "existing":
      return NextResponse.json({ revision: result.revision, replayed: true }, { status: 200 });
    case "request_id_conflict":
      return NextResponse.json(
        { error: "request_id_conflict", message: "That request id was already used for a different review." },
        { status: 409 },
      );
    case "job_sheet_not_found":
      return NextResponse.json(NOT_FOUND, { status: 404 });
    case "revision_not_found":
      return NextResponse.json({ error: "revision_not_found" }, { status: 404 });
  }
}
