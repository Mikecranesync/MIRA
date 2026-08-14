/**
 * GET  /api/equipment-notebooks — list this tenant's notebooks.
 * POST /api/equipment-notebooks — create one (manual path or confirmed scan).
 *
 * Tenant-scoped via sessionOr401 (UUID tenants only) + withTenantContext RLS.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { createNotebook, listNotebooks } from "@/lib/equipment-notebooks";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const notebooks = await listNotebooks(ctx.tenantId);
  return NextResponse.json({ notebooks });
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
    return NextResponse.json({ notebook }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    const status = msg.startsWith("display_name") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
