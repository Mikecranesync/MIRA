import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const data = await withTenantContext(ctx.tenantId, async (c) => {
      const { rows: monthRows } = await c.query(
        `SELECT
          COUNT(*) as total_actions,
          COUNT(DISTINCT telegram_username) as unique_techs,
          COUNT(DISTINCT source) as active_channels,
          COUNT(CASE WHEN safety_warnings != '{}' THEN 1 END) as safety_alerts,
          COUNT(CASE WHEN status = 'completed' OR status = 'cancelled' THEN 1 END) as resolved,
          SUM(CASE WHEN confidence_score IS NOT NULL THEN 1 ELSE 0 END) as diagnostics
        FROM work_orders
        WHERE created_at > date_trunc('month', NOW()) AND tenant_id = $1`,
        [ctx.tenantId],
      );
      const { rows: allTimeRows } = await c.query(
        `SELECT COUNT(*) as total FROM work_orders WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      const { rows: dailyRows } = await c.query(
        `SELECT
          DATE(created_at AT TIME ZONE 'UTC') as day,
          COUNT(*) as count
        FROM work_orders
        WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1
        GROUP BY day ORDER BY day ASC`,
        [ctx.tenantId],
      );
      const { rows: bySourceRows } = await c.query(
        `SELECT source, COUNT(*) as count
        FROM work_orders
        WHERE source IS NOT NULL
          AND created_at > date_trunc('month', NOW())
          AND tenant_id = $1
        GROUP BY source ORDER BY count DESC`,
        [ctx.tenantId],
      );
      const { rows: byTechRows } = await c.query(
        `SELECT telegram_username, source, COUNT(*) as count
        FROM work_orders
        WHERE telegram_username IS NOT NULL
          AND created_at > date_trunc('month', NOW())
          AND tenant_id = $1
        GROUP BY telegram_username, source
        ORDER BY count DESC LIMIT 10`,
        [ctx.tenantId],
      );
      const { rows: kbRows } = await c.query(
        `SELECT COUNT(*) as total_chunks FROM kb_chunks WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      return { monthRows, allTimeRows, dailyRows, bySourceRows, byTechRows, kbRows };
    });

    const month = data.monthRows[0] as Record<string, unknown>;
    return NextResponse.json({
      thisMonth: {
        totalActions: Number(month.total_actions),
        uniqueTechs: Number(month.unique_techs),
        activeChannels: Number(month.active_channels),
        safetyAlerts: Number(month.safety_alerts),
        diagnostics: Number(month.diagnostics),
        resolved: Number(month.resolved),
      },
      allTime: {
        totalWorkOrders: Number((data.allTimeRows[0] as Record<string, unknown>).total),
        totalKbChunks: Number((data.kbRows[0] as Record<string, unknown>).total_chunks),
      },
      daily: data.dailyRows.map((r: Record<string, unknown>) => ({ day: r.day, count: Number(r.count) })),
      bySource: data.bySourceRows.map((r: Record<string, unknown>) => ({ source: r.source, count: Number(r.count) })),
      byTech: data.byTechRows.map((r: Record<string, unknown>) => ({
        username: r.telegram_username,
        channel: r.source,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    console.error("[api/usage]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
