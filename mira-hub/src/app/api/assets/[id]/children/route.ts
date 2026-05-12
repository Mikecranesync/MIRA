import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function rowToAsset(r: Record<string, unknown>) {
  return {
    id: r.id,
    tag: r.equipment_number ?? r.id,
    name:
      (r.description as string) ||
      [r.manufacturer, r.model_number, r.equipment_type].filter(Boolean).join(" "),
    manufacturer: r.manufacturer ?? null,
    model: r.model_number ?? null,
    type: r.equipment_type ?? null,
    criticality: r.criticality ?? "medium",
    parentAssetId: r.parent_asset_id ?? null,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, equipment_number, manufacturer, model_number,
          equipment_type, criticality, description, parent_asset_id
        FROM cmms_equipment
        WHERE parent_asset_id = $1 AND tenant_id = $2
        ORDER BY equipment_number ASC NULLS LAST, created_at ASC`,
        [id, ctx.tenantId],
      ).then((r) => r.rows),
    );
    return NextResponse.json(rows.map(rowToAsset));
  } catch (err) {
    console.error("[api/assets/[id]/children GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
