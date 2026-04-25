import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const { rows } = await pool.query(
      `
      SELECT
        telegram_username,
        source,
        COUNT(*) as message_count,
        MAX(created_at) as last_activity,
        array_agg(DISTINCT equipment_type) FILTER (WHERE equipment_type IS NOT NULL) as assets,
        array_agg(DISTINCT manufacturer) FILTER (WHERE manufacturer IS NOT NULL) as manufacturers,
        COUNT(CASE WHEN safety_warnings != '{}' THEN 1 END) as safety_count,
        MAX(title) as last_message
      FROM work_orders
      WHERE telegram_username IS NOT NULL AND tenant_id = $1
      GROUP BY telegram_username, source
      ORDER BY last_activity DESC
      LIMIT 30
    `,
      [ctx.tenantId],
    );

    const { rows: tgRows } = await pool.query(
      `SELECT username, chat_id, content, timestamp, is_from_bot, metadata
         FROM telegram_messages
        WHERE tenant_id = $1
        ORDER BY timestamp DESC
        LIMIT 50`,
      [ctx.tenantId],
    );

    const threads = rows.map((r) => ({
      id: r.telegram_username,
      tech: r.telegram_username,
      channel: r.source ?? "Telegram",
      messageCount: Number(r.message_count),
      lastActivity: r.last_activity,
      assets: r.assets ?? [],
      hasSafetyAlert: Number(r.safety_count) > 0,
      lastMessage: r.last_message ?? "",
      manufacturers: r.manufacturers ?? [],
    }));

    const messages = tgRows.map((m) => ({
      id: m.chat_id,
      username: m.username,
      content: m.content,
      timestamp: m.timestamp,
      isFromBot: m.is_from_bot,
    }));

    return NextResponse.json({ threads, messages });
  } catch (err) {
    console.error("[api/conversations]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
