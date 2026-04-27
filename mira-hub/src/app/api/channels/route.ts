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
    const channels = await withTenantContext(ctx.tenantId, async (c) => {
      const { rows: woRows } = await c.query(
        `SELECT
          source,
          COUNT(*) as total_events,
          COUNT(DISTINCT telegram_username) as unique_techs,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as events_24h,
          MAX(created_at) as last_activity
        FROM work_orders
        WHERE source IS NOT NULL AND tenant_id = $1
        GROUP BY source
        ORDER BY total_events DESC`,
        [ctx.tenantId],
      );
      const { rows: tgRows } = await c.query(
        `SELECT
          COUNT(*) as total_messages,
          COUNT(DISTINCT chat_id) as unique_chats,
          MAX(timestamp) as last_message
        FROM telegram_messages
        WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      const tg = tgRows[0] as Record<string, unknown>;
      const result = woRows.map((r: Record<string, unknown>) => ({
        id: r.source,
        name: r.source,
        totalEvents: Number(r.total_events),
        uniqueTechs: Number(r.unique_techs),
        events24h: Number(r.events_24h),
        lastActivity: r.last_activity,
        healthy: true,
      }));
      if (tg && Number(tg.total_messages) > 0) {
        const existing = result.find((ch) => ch.id === "telegram");
        if (existing) {
          existing.totalEvents += Number(tg.total_messages);
        } else {
          result.push({
            id: "telegram",
            name: "telegram",
            totalEvents: Number(tg.total_messages),
            uniqueTechs: Number(tg.unique_chats),
            events24h: 0,
            lastActivity: tg.last_message,
            healthy: true,
          });
        }
      }
      return result;
    });

    return NextResponse.json(channels);
  } catch (err) {
    console.error("[api/channels]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
