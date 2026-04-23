import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  try {
    // Traffic from work_orders (grouped by source)
    const { rows: woRows } = await pool.query(`
      SELECT
        source,
        COUNT(*) as total_events,
        COUNT(DISTINCT telegram_username) as unique_techs,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as events_24h,
        MAX(created_at) as last_activity
      FROM work_orders
      WHERE source IS NOT NULL
      GROUP BY source
      ORDER BY total_events DESC
    `);

    // Real telegram traffic
    const { rows: tgRows } = await pool.query(`
      SELECT
        COUNT(*) as total_messages,
        COUNT(DISTINCT chat_id) as unique_chats,
        MAX(timestamp) as last_message
      FROM telegram_messages
    `);

    const tg = tgRows[0];
    const channels = woRows.map((r) => ({
      id: r.source,
      name: r.source,
      totalEvents: Number(r.total_events),
      uniqueTechs: Number(r.unique_techs),
      events24h: Number(r.events_24h),
      lastActivity: r.last_activity,
      healthy: true,
    }));

    // Supplement telegram with actual message count
    if (tg && Number(tg.total_messages) > 0) {
      const existing = channels.find((c) => c.id === "telegram");
      if (existing) {
        existing.totalEvents += Number(tg.total_messages);
      } else {
        channels.push({
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

    return NextResponse.json(channels);
  } catch (err) {
    console.error("[api/channels]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
