import { NextResponse } from "next/server";
import { sessionOrDemo, isDemoTenant } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/demo/customer
 *
 * Returns the demo asset tree for the tablet's entry page:
 *   { tenant, sites: [{ id, name, areas: [{ id, name, lines: [{ id, name,
 *     equipment: [{ id, name, asset_tag, components: [...] }] }] }] }] }
 *
 * Reads from kg_entities (UNS hierarchy) + installed_component_instances.
 * Single-round-trip; demo-grade — no pagination, no caching.
 */
export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!isDemoTenant(ctx.tenantId)) {
    return NextResponse.json(
      { error: "Demo tree only available for the demo tenant" },
      { status: 403 },
    );
  }

  try {
    const tree = await withTenantContext(ctx.tenantId, async (c) => {
      const ents = await c.query(
        `SELECT id, entity_type, entity_id, name, uns_path::text AS uns_path, properties
           FROM kg_entities
          WHERE tenant_id = $1
            AND entity_type IN ('tenant','site','area','line','equipment','component')
          ORDER BY uns_path`,
        [ctx.tenantId],
      );

      const components = await c.query(
        `SELECT i.id, i.component_name, i.canonical_name, i.aliases, i.asset_id,
                i.plc_tag, i.mqtt_topic, i.uns_path::text AS uns_path,
                t.manufacturer, t.model, t.component_category
           FROM installed_component_instances i
           LEFT JOIN component_templates t ON t.id = i.template_id
          WHERE i.tenant_id = $1
          ORDER BY i.uns_path`,
        [ctx.tenantId],
      );

      return { entities: ents.rows, components: components.rows };
    });

    const byType = new Map<string, Array<Record<string, unknown>>>();
    for (const r of tree.entities) {
      const t = r.entity_type as string;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(r as Record<string, unknown>);
    }

    const sites = (byType.get("site") ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      areas: (byType.get("area") ?? [])
        .filter((a) => (a.uns_path as string).startsWith((s.uns_path as string) + "."))
        .map((a) => ({
          id: a.id,
          name: a.name,
          lines: (byType.get("line") ?? [])
            .filter((l) => (l.uns_path as string).startsWith((a.uns_path as string) + "."))
            .map((l) => ({
              id: l.id,
              name: l.name,
              equipment: (byType.get("equipment") ?? [])
                .filter((e) => (e.uns_path as string).startsWith((l.uns_path as string) + "."))
                .map((e) => ({
                  id: e.id,
                  name: e.name,
                  asset_tag:
                    (e.properties as Record<string, unknown> | null)?.asset_tag ??
                    null,
                  uns_path: e.uns_path,
                  components: (tree.components as Array<Record<string, unknown>>)
                    .filter((cmp) => cmp.asset_id === e.id)
                    .map((cmp) => ({
                      id: cmp.id,
                      name: cmp.component_name,
                      canonical_name: cmp.canonical_name,
                      aliases: cmp.aliases ?? [],
                      manufacturer: cmp.manufacturer,
                      model: cmp.model,
                      category: cmp.component_category,
                      plc_tag: cmp.plc_tag,
                      mqtt_topic: cmp.mqtt_topic,
                      uns_path: cmp.uns_path,
                    })),
                })),
            })),
        })),
    }));

    return NextResponse.json({
      tenant: byType.get("tenant")?.[0] ?? { id: ctx.tenantId, name: "Demo" },
      sites,
    });
  } catch (err) {
    console.error("[api/demo/customer GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
