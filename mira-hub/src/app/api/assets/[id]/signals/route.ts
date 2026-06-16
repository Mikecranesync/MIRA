import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/signals?limit=20&since=ISO8601
 *
 * One signal card per installed component on the asset:
 *   { components: [{ id, name, plc_tag, latest: {value, ts, state}, history: [...] }] }
 *
 * Reads live_signal_events ordered by created_at DESC. Demo-only; real-time
 * feeds will replace this with a WebSocket bridge to the UNS broker.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));
  const since = url.searchParams.get("since");

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const components = await c
        .query(
          `SELECT id, component_name, plc_tag
             FROM installed_component_instances
            WHERE tenant_id = $1 AND asset_id = $2
            ORDER BY component_name`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows);

      if (components.length === 0) return { components: [] };

      const componentIds = components.map((r: Record<string, unknown>) => r.id as string);

      const sinceClause = since ? "AND created_at >= $3" : "";
      const queryParams: unknown[] = [ctx.tenantId, componentIds];
      if (since) queryParams.push(since);

      const events = await c
        .query(
          `SELECT id, component_id, plc_tag, value_text, value_numeric, value_bool,
                  simulated, source, properties, created_at
             FROM live_signal_events
            WHERE tenant_id = $1
              AND component_id = ANY($2::uuid[])
              ${sinceClause}
            ORDER BY created_at DESC
            LIMIT ${limit * componentIds.length}`,
          queryParams,
        )
        .then((r) => r.rows);

      const byComponent = new Map<string, Array<Record<string, unknown>>>();
      for (const ev of events) {
        const cid = ev.component_id as string;
        if (!byComponent.has(cid)) byComponent.set(cid, []);
        byComponent.get(cid)!.push(ev);
      }

      return {
        components: components.map((cmp: Record<string, unknown>) => {
          const history = (byComponent.get(cmp.id as string) ?? []).slice(0, limit);
          const latest = history[0] ?? null;
          return {
            id: cmp.id,
            name: cmp.component_name,
            plc_tag: cmp.plc_tag,
            latest: latest
              ? {
                  ts: latest.created_at,
                  value:
                    latest.value_text ??
                    latest.value_numeric ??
                    latest.value_bool ??
                    null,
                  simulated: latest.simulated,
                  source: latest.source,
                }
              : null,
            history: history.map((h) => ({
              ts: h.created_at,
              value: h.value_text ?? h.value_numeric ?? h.value_bool ?? null,
              simulated: h.simulated,
            })),
          };
        }),
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/signals GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
