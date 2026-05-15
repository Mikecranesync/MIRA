import { NextResponse } from "next/server";
import { sessionOrDemo, isDemoTenant } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface CacheRow {
  plc_tag: string;
  component_id: string | null;
  component_name: string | null;
  asset_id: string | null;
  asset_name: string | null;
  last_value_text: string | null;
  last_value_numeric: number | null;
  last_value_bool: boolean | null;
  prev_value_text: string | null;
  prev_value_numeric: number | null;
  prev_value_bool: boolean | null;
  last_seen_at: string;
  last_changed_at: string;
  simulated: boolean;
  source: string;
  properties: Record<string, unknown>;
}

/**
 * GET /api/demo/signals/summary
 *
 * Snapshot of the current value for every topic the demo tenant has touched.
 * Reads live_signal_cache directly (the denormalized table maintained by
 * `recordSignalValue`) so the tablet can render a "current state" panel in
 * one query without polling per-component endpoints.
 *
 * Joins through installed_component_instances → kg_entities so each cache
 * row carries asset_name / component_name when bindings exist. Cache rows
 * for unbound tags still appear with NULL component fields.
 *
 * Sort order: most-recently-changed first (helps the tablet animate the
 * thing that just flipped).
 *
 * Demo-tenant only.
 */
export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!isDemoTenant(ctx.tenantId)) {
    return NextResponse.json(
      { error: "Signal summary is demo-tenant only" },
      { status: 403 },
    );
  }

  try {
    const rows = await withTenantContext<CacheRow[]>(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT
              cache.plc_tag,
              cache.component_id,
              i.component_name,
              i.asset_id,
              asset.name AS asset_name,
              cache.last_value_text,
              cache.last_value_numeric,
              cache.last_value_bool,
              cache.prev_value_text,
              cache.prev_value_numeric,
              cache.prev_value_bool,
              cache.last_seen_at,
              cache.last_changed_at,
              cache.simulated,
              cache.source,
              cache.properties
            FROM live_signal_cache cache
            LEFT JOIN installed_component_instances i
              ON i.id = cache.component_id
            LEFT JOIN kg_entities asset
              ON asset.id = i.asset_id
            WHERE cache.tenant_id = $1
            ORDER BY cache.last_changed_at DESC`,
          [ctx.tenantId],
        )
        .then((r: { rows: CacheRow[] }) => r.rows),
    );

    return NextResponse.json(
      {
        signals: rows.map((r: CacheRow) => ({
          plc_tag: r.plc_tag,
          component_id: r.component_id,
          component_name: r.component_name,
          asset_id: r.asset_id,
          asset_name: r.asset_name,
          value: r.last_value_text ?? r.last_value_numeric ?? r.last_value_bool,
          previous_value:
            r.prev_value_text ?? r.prev_value_numeric ?? r.prev_value_bool ?? null,
          last_seen_at: r.last_seen_at,
          last_changed_at: r.last_changed_at,
          simulated: r.simulated,
          source: r.source,
          properties: r.properties,
        })),
        count: rows.length,
        as_of: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/demo/signals/summary GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
