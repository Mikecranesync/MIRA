import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function rowToAsset(r: Record<string, unknown>) {
  return {
    id: r.id,
    tag: r.equipment_number ?? r.id,
    name: (r.description as string) || [r.manufacturer, r.model_number, r.equipment_type].filter(Boolean).join(" "),
    manufacturer: r.manufacturer ?? null,
    model: r.model_number ?? null,
    serialNumber: r.serial_number ?? null,
    type: r.equipment_type ?? null,
    location: r.location ?? null,
    department: r.department ?? null,
    criticality: r.criticality ?? "medium",
    workOrderCount: r.work_order_count ?? 0,
    downtimeHours: r.total_downtime_hours ?? 0,
    lastMaintenance: r.last_maintenance_date ?? null,
    lastWorkOrder: r.last_work_order_at ?? null,
    lastFault: r.last_reported_fault ?? null,
    description: r.description ?? null,
    installDate: r.installation_date ?? null,
    createdAt: r.created_at ?? null,
    parentAssetId: r.parent_asset_id ?? null,
    qrGeneratedAt: r.qr_generated_at ?? null,
    externalIds: {
      cmmsId: (r.cmms_id as string | null) ?? null,
      plcTag: (r.plc_tag as string | null) ?? null,
      scadaPath: (r.scada_path as string | null) ?? null,
      manufacturerPartNumber: (r.manufacturer_part_number as string | null) ?? null,
      unsTopicPath: (r.uns_topic_path as string | null) ?? null,
      erpAssetId: (r.erp_asset_id as string | null) ?? null,
      drawingReference: (r.drawing_reference as string | null) ?? null,
    },
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tag: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag).trim();
  if (!tag || !/^[A-Za-z0-9_-]{1,64}$/.test(tag)) {
    return NextResponse.json({ error: "invalid tag" }, { status: 400 });
  }

  try {
    const row = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, equipment_number, manufacturer, model_number, serial_number,
          equipment_type, location, department, criticality,
          work_order_count, total_downtime_hours,
          last_maintenance_date, last_work_order_at,
          last_reported_fault, description, installation_date, created_at,
          parent_asset_id, qr_generated_at,
          cmms_id, plc_tag, scada_path, manufacturer_part_number,
          uns_topic_path, erp_asset_id, drawing_reference
        FROM cmms_equipment
        WHERE equipment_number = $1 AND tenant_id = $2
        LIMIT 1`,
        [tag, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );

    if (!row) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Include sub-component children (assets whose parent_asset_id points
    // here). Compact shape — full detail is reachable via /m/{tag}.
    const children = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT id, equipment_number, manufacturer, model_number, description, equipment_type
           FROM cmms_equipment
          WHERE parent_asset_id = $1 AND tenant_id = $2
          ORDER BY equipment_number ASC NULLS LAST`,
        [row.id, ctx.tenantId],
      ).then((r) => r.rows),
    );

    return NextResponse.json({
      ...rowToAsset(row),
      children: children.map((c: Record<string, unknown>) => ({
        id: c.id,
        tag: c.equipment_number ?? null,
        name: (c.description as string) || [c.manufacturer, c.model_number, c.equipment_type].filter(Boolean).join(" "),
        manufacturer: c.manufacturer ?? null,
        model: c.model_number ?? null,
      })),
    });
  } catch (err) {
    console.error("[api/assets/by-tag/[tag] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
