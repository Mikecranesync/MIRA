import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/components/[id]
 *
 * Component detail = installed_component_instance row joined with its
 * component_template (catalog) plus recent KG relationships in/out.
 *
 *   { component: {...}, template: {...}, edges: [{type, source/target}] }
 *
 * The tablet uses this to render the component card with PE-001's
 * troubleshooting steps, failure modes, expected signal envelope, etc.
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
      const row = await c
        .query(
          `SELECT
              i.id, i.component_name, i.canonical_name, i.aliases,
              i.asset_id, i.installed_location, i.panel, i.terminal,
              i.wire_number, i.plc_tag, i.mqtt_topic,
              i.uns_path::text AS uns_path, i.human_confirmed, i.confidence,
              i.notes,
              i.template_id,
              t.component_category, t.component_type,
              t.manufacturer, t.model, t.description,
              t.power_specs, t.input_output_specs, t.signal_behavior,
              t.connector_type, t.pinout, t.environmental_limits,
              t.diagnostic_indicators, t.expected_signals,
              t.common_failure_modes, t.troubleshooting_steps,
              t.pm_checks, t.safety_notes,
              t.verification_status AS template_verification_status
            FROM installed_component_instances i
            LEFT JOIN component_templates t ON t.id = i.template_id
           WHERE i.tenant_id = $1 AND i.id = $2
           LIMIT 1`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows[0] ?? null);

      if (!row) return null;

      const edges = await c
        .query(
          `SELECT r.id, r.relationship_type, r.confidence, r.properties,
                  src.entity_type AS source_type, src.entity_id AS source_eid, src.name AS source_name,
                  tgt.entity_type AS target_type, tgt.entity_id AS target_eid, tgt.name AS target_name
             FROM kg_relationships r
             JOIN kg_entities src ON src.id = r.source_id
             JOIN kg_entities tgt ON tgt.id = r.target_id
            WHERE r.tenant_id = $1
              AND (r.source_id = $2 OR r.target_id = $2)
            ORDER BY r.confidence DESC, r.created_at DESC
            LIMIT 50`,
          [ctx.tenantId, id],
        )
        .then((r) => r.rows);

      return {
        component: {
          id: row.id,
          name: row.component_name,
          canonical_name: row.canonical_name,
          aliases: row.aliases ?? [],
          asset_id: row.asset_id,
          installed_location: row.installed_location,
          panel: row.panel,
          terminal: row.terminal,
          wire_number: row.wire_number,
          plc_tag: row.plc_tag,
          mqtt_topic: row.mqtt_topic,
          uns_path: row.uns_path,
          human_confirmed: row.human_confirmed,
          confidence: row.confidence,
          notes: row.notes,
        },
        template: row.template_id
          ? {
              id: row.template_id,
              category: row.component_category,
              type: row.component_type,
              manufacturer: row.manufacturer,
              model: row.model,
              description: row.description,
              power_specs: row.power_specs,
              input_output_specs: row.input_output_specs,
              signal_behavior: row.signal_behavior,
              connector_type: row.connector_type,
              pinout: row.pinout,
              environmental_limits: row.environmental_limits,
              diagnostic_indicators: row.diagnostic_indicators,
              expected_signals: row.expected_signals,
              common_failure_modes: row.common_failure_modes,
              troubleshooting_steps: row.troubleshooting_steps,
              pm_checks: row.pm_checks,
              safety_notes: row.safety_notes,
              verification_status: row.template_verification_status,
            }
          : null,
        edges: edges.map((e: Record<string, unknown>) => ({
          id: e.id,
          type: e.relationship_type,
          confidence: e.confidence,
          direction: e.source_eid === row.id ? "out" : "in",
          source: { type: e.source_type, entity_id: e.source_eid, name: e.source_name },
          target: { type: e.target_type, entity_id: e.target_eid, name: e.target_name },
          properties: e.properties,
        })),
      };
    });

    if (!result) {
      return NextResponse.json({ error: "Component not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/components/[id] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
