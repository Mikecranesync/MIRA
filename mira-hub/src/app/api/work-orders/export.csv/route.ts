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
            work_order_number,
            title,
            COALESCE(manufacturer, '') || ' ' || COALESCE(model_number, '') AS asset,
            manufacturer,
            model_number,
            status,
            priority,
            source,
            suggested_actions,
            safety_warnings,
            description,
            created_at,
            updated_at
          FROM work_orders
          WHERE tenant_id = $1
          ORDER BY
            CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
            CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
            created_at DESC
          LIMIT 1000`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return csvResponse(toCsv(rows), "work-orders.csv");
  } catch (err) {
    const msg = String(err);
    if (msg.includes("work_orders") && msg.includes("does not exist")) {
      return csvResponse("", "work-orders.csv");
    }
    console.error("[api/work-orders/export.csv GET]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
