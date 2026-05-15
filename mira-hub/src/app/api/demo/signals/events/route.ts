import { NextResponse } from "next/server";
import { sessionOrDemo, isDemoTenant } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/demo/signals/events?component_id=&limit=&since=
 *
 * Append-only signal event history for the demo tenant. The tablet polls
 * this every 1–2 s while a session is open so the "live signal" card on the
 * conveyor demo updates in near-real-time without a WebSocket.
 *
 * Filters:
 *   - component_id (UUID): scope to one component
 *   - since (ISO8601): only events after this timestamp
 *   - limit (default 50, max 500)
 */
export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!isDemoTenant(ctx.tenantId)) {
    return NextResponse.json(
      { error: "Signal events feed is demo-tenant only" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const componentId = url.searchParams.get("component_id");
  const since = url.searchParams.get("since");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const where: string[] = [`e.tenant_id = $1`];
  const params: unknown[] = [ctx.tenantId];

  if (componentId) {
    params.push(componentId);
    where.push(`e.component_id = $${params.length}`);
  }
  if (since) {
    params.push(since);
    where.push(`e.created_at > $${params.length}`);
  }

  try {
    const rows = await withTenantContext<Record<string, unknown>[]>(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT e.id, e.component_id, e.plc_tag, e.value_text, e.value_numeric,
                  e.value_bool, e.simulated, e.source, e.properties, e.created_at,
                  i.component_name
             FROM live_signal_events e
             LEFT JOIN installed_component_instances i ON i.id = e.component_id
            WHERE ${where.join(" AND ")}
            ORDER BY e.created_at DESC
            LIMIT ${limit}`,
          params,
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows),
    );

    return NextResponse.json(
      {
        events: rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          component_id: r.component_id,
          component_name: r.component_name,
          plc_tag: r.plc_tag,
          value: r.value_text ?? r.value_numeric ?? r.value_bool ?? null,
          simulated: r.simulated,
          source: r.source,
          properties: r.properties,
          ts: r.created_at,
        })),
        count: rows.length,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    console.error("[api/demo/signals/events GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
