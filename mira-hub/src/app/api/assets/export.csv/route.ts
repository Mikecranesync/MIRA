import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { toCsv, csvResponse } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT
            id,
            equipment_number AS tag,
            COALESCE(description, manufacturer || ' ' || COALESCE(model_number, '')) AS name,
            manufacturer,
            model_number AS model,
            serial_number,
            equipment_type AS type,
            location,
            department,
            criticality,
            work_order_count,
            total_downtime_hours,
            last_maintenance_date,
            last_work_order_at,
            last_reported_fault,
            created_at
          FROM cmms_equipment
          WHERE tenant_id = $1
          ORDER BY last_work_order_at DESC NULLS LAST, created_at DESC
          LIMIT 1000`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return csvResponse(toCsv(rows), "assets.csv");
  } catch (err) {
    console.error("[api/assets/export.csv GET]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
