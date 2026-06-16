import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const severity = url.searchParams.get("severity");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [ctx.tenantId]);

    const params: unknown[] = [ctx.tenantId, limit];
    const severityFilter = severity ? `AND severity = $3` : "";
    if (severity) params.push(severity);

    const { rows } = await client.query(
      `SELECT id, event_type, severity, asset_id, keyword, payload, created_at
       FROM agent_events
       WHERE tenant_id = $1 AND event_type = 'safety_alert'
       ${severityFilter}
       ORDER BY created_at DESC
       LIMIT $2`,
      params,
    );
    await client.query("COMMIT");

    return NextResponse.json({ events: rows, total: rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[api/agents/safety-events]", err);
    // Table may not exist yet — return empty rather than 500
    return NextResponse.json({ events: [], total: 0 });
  } finally {
    client.release();
  }
}
