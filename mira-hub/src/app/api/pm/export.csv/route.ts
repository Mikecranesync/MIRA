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
            COALESCE(manufacturer, '') || ' ' || COALESCE(model_number, '') AS asset,
            task AS title,
            interval_value,
            interval_unit,
            estimated_duration_minutes,
            criticality,
            COALESCE(trigger_type, 'calendar') AS trigger_type,
            meter_type,
            meter_threshold,
            COALESCE(meter_current, 0) AS meter_current,
            next_due_at,
            last_completed_at,
            auto_extracted,
            source_citation,
            parts_needed,
            tools_needed,
            safety_requirements,
            created_at
          FROM pm_schedules
          WHERE tenant_id = $1
          ORDER BY next_due_at ASC NULLS LAST
          LIMIT 1000`,
          [ctx.tenantId],
        )
        .then((r) => r.rows),
    );

    return csvResponse(toCsv(rows), "pm-schedule.csv");
  } catch (err) {
    const msg = String(err);
    if (msg.includes("pm_schedules") && msg.includes("does not exist")) {
      return csvResponse("", "pm-schedule.csv");
    }
    console.error("[api/pm/export.csv GET]", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
