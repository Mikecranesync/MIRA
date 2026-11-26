/**
 * GET  /api/equipment-notebooks — list this tenant's notebooks.
 * POST /api/equipment-notebooks — create one (manual path or confirmed scan).
 *
 * Tenant-scoped via sessionOr401 (UUID tenants only) + withTenantContext RLS.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { createNotebook, listNotebooksWithThreads } from "@/lib/equipment-notebooks";
import { startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";

export const dynamic = "force-dynamic";

const LIST_CACHE_HEADERS = { "Cache-Control": "private, no-store" };
const TRANSIENT_DB_CODES = new Set([
  "53300", "57014", "57P01", "57P02", "57P03",
  "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EPIPE", "ETIMEDOUT",
]);

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const notebooks = await listNotebooksWithThreads(ctx.tenantId, ctx.userId);
    return NextResponse.json({ notebooks }, { headers: LIST_CACHE_HEADERS });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
    const poolTimeout = error instanceof Error &&
      /^(?:timeout exceeded when trying to connect|Connection terminated due to connection timeout)$/.test(error.message);
    const retryable = poolTimeout || /^08[A-Z0-9]{3}$/.test(code) || TRANSIENT_DB_CODES.has(code);
    console.error("[equipment-notebooks:list] read failed", {
      reason: poolTimeout ? "pool_timeout" : retryable ? "storage_unavailable" : "read_failed",
      code: /^[A-Z0-9]{5}$/.test(code) || TRANSIENT_DB_CODES.has(code) ? code : undefined,
    });
    return NextResponse.json(
      { error: retryable ? "project_list_temporarily_unavailable" : "project_list_failed", retryable },
      {
        status: retryable ? 503 : 500,
        headers: retryable ? { ...LIST_CACHE_HEADERS, "Retry-After": "1" } : LIST_CACHE_HEADERS,
      },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  if (!displayName.trim()) {
    return NextResponse.json({ error: "display_name_required" }, { status: 400 });
  }
  const identityStatus =
    body.identityStatus === "user_confirmed" || body.identityStatus === "candidate"
      ? body.identityStatus
      : "unknown";
  try {
    const notebook = await createNotebook(ctx.tenantId, {
      displayName,
      manufacturer: (body.manufacturer as string) ?? null,
      model: (body.model as string) ?? null,
      catalogNumber: (body.catalogNumber as string) ?? null,
      serialNumber: (body.serialNumber as string) ?? null,
      equipmentType: (body.equipmentType as string) ?? null,
      assetTag: (body.assetTag as string) ?? null,
      locationLabel: (body.locationLabel as string) ?? null,
      identityStatus,
      identityConfidence:
        typeof body.identityConfidence === "number" ? body.identityConfidence : null,
      identitySourceType:
        body.identitySourceType === "nameplate_image" ||
        body.identitySourceType === "existing_asset" ||
        body.identitySourceType === "user"
          ? body.identitySourceType
          : "manual",
      identityObservation: body.identityObservation ?? null,
      createdBy: ctx.userId ?? null,
    });
    // #4075 — a technician-confirmed identity (the Scan machine flow) starts the
    // search for its official manual in the background, so the first question
    // can already have it. Never awaited; a no-op unless enabled and confirmed.
    await startManualAcquisition({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      notebookId: notebook.id,
      nodeId: notebook.nodeId,
      identity: {
        identityStatus: notebook.identityStatus,
        manufacturer: notebook.manufacturer,
        model: notebook.model,
        catalogNumber: notebook.catalogNumber,
      },
    });
    return NextResponse.json({ notebook }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    const status = msg.startsWith("display_name") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
