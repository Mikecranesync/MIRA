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
    const row = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          id, equipment_number, manufacturer, model_number, serial_number,
          equipment_type, location, department, criticality,
          work_order_count, total_downtime_hours,
          last_maintenance_date, last_work_order_at,
          last_reported_fault, description, installation_date, created_at
        FROM cmms_equipment
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
        [id, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );

    if (!row) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    return NextResponse.json(rowToAsset(row));
  } catch (err) {
    console.error("[api/assets/[id] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
