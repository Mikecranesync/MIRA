import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/context
 *
 * Returns the minimum context the tablet needs to render the "is this the
 * right asset?" confirmation card before unlocking troubleshooting:
 *   - asset (id, name, asset_tag, uns_path)
 *   - components count + names
 *   - recent_signal_count
 *   - recent_work_order_count
 *
 * Used by the UNS Confirmation Gate. If the asset is missing or has no
 * components, returns the asset row but flags `ready_for_troubleshooting=false`.
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

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      const assetRow = await c
        .query(
          `SELECT id, entity_id, name, uns_path::text AS uns_path, properties
             FROM kg_entities
            WHERE tenant_id = $1 AND id = $2 AND entity_type = 'equipment'
            LIMIT 1`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows[0] ?? null);

      if (!assetRow) return null;

      const components = await c
        .query(
          `SELECT id, component_name, canonical_name, plc_tag
             FROM installed_component_instances
            WHERE tenant_id = $1 AND asset_id = $2
            ORDER BY component_name`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows);

      const signals = await c
        .query(
          `SELECT COUNT(*)::int AS n
             FROM live_signal_events e
             JOIN installed_component_instances i ON i.id = e.component_id
            WHERE e.tenant_id = $1 AND i.asset_id = $2
              AND e.created_at > now() - interval '24 hours'`,
          [ctx.tenantId, id],
        )
        .then((r) => Number(r.rows[0]?.n ?? 0));

      const props = (assetRow.properties as Record<string, unknown> | null) ?? {};

      return {
        asset: {
          id: assetRow.id,
          name: assetRow.name,
          asset_tag: props.asset_tag ?? null,
          manufacturer: props.manufacturer ?? null,
          model: props.model ?? null,
          uns_path: assetRow.uns_path,
        },
        components: components.map((cmp: Record<string, unknown>) => ({
          id: cmp.id,
          name: cmp.component_name,
          canonical_name: cmp.canonical_name,
          plc_tag: cmp.plc_tag,
        })),
        recent_signal_count_24h: signals,
        ready_for_troubleshooting: components.length > 0,
      };
    });

    if (!result) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/context GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
