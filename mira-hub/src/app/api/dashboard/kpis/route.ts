import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface KpiRow {
  open_work_orders: string;
  overdue_pms: string;
  high_priority_open: string;
  completed_this_week: string;
  total_recent: string;
}

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const [kpis] = await withTenantContext(ctx.tenantId, async (c) => {
      const result = await c.query<KpiRow>(`
        WITH wo_counts AS (
          SELECT
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_work_orders,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')
              AND priority IN ('critical', 'high')) AS high_priority_open,
            COUNT(*) FILTER (WHERE status = 'completed'
              AND updated_at > NOW() - INTERVAL '7 days') AS completed_this_week,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS total_recent
          FROM work_orders
        ),
        pm_counts AS (
          SELECT COUNT(*) AS overdue_pms
          FROM pm_schedules
          WHERE next_due_at IS NOT NULL
            AND next_due_at < NOW()
            AND (last_completed_at IS NULL OR last_completed_at < next_due_at)
        )
        SELECT
          wo_counts.open_work_orders,
          pm_counts.overdue_pms,
          wo_counts.high_priority_open,
          wo_counts.completed_this_week,
          wo_counts.total_recent
        FROM wo_counts, pm_counts
      `);
      return result.rows;
    });

    const openWOs = Number(kpis?.open_work_orders ?? 0);
    const overduePMs = Number(kpis?.overdue_pms ?? 0);
    const highPriorityOpen = Number(kpis?.high_priority_open ?? 0);
    const completedWeek = Number(kpis?.completed_this_week ?? 0);
    const totalRecent = Number(kpis?.total_recent ?? 0);

    // Wrench time proxy: completed-this-week / (completed-this-week + open).
    // Real wrench time needs per-WO time tracking which work_orders doesn't carry yet.
    const denom = completedWeek + openWOs;
    const wrenchTimePct = denom > 0 ? Math.round((completedWeek / denom) * 100) : null;

    return NextResponse.json({
      openWorkOrders: openWOs,
      overduePMs,
      // "Downtime Today" proxy — count of high-priority open WOs (best signal we have
      // without per-asset downtime tracking; FAC-? to add it).
      highPriorityOpen,
      // Null when we don't have enough data to compute a meaningful number.
      wrenchTimePct,
      // Surface the raw counts so the page can choose how to render them.
      meta: {
        completedThisWeek: completedWeek,
        totalRecent: totalRecent,
        approximations: ["highPriorityOpen ≈ downtime", "wrenchTimePct ≈ throughput"],
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tables might not exist for a brand-new tenant — return zeros, not 500.
    if (msg.includes("does not exist")) {
      return NextResponse.json({
        openWorkOrders: 0,
        overduePMs: 0,
        highPriorityOpen: 0,
        wrenchTimePct: null,
        meta: { completedThisWeek: 0, totalRecent: 0, approximations: [] },
        fetchedAt: new Date().toISOString(),
      });
    }
    console.error("[api/dashboard/kpis] query failed", {
      tenantId: ctx.tenantId,
      error: msg,
    });
    return NextResponse.json(
      { error: "kpis_unavailable", reason: msg },
      { status: 503 },
    );
  }
}
