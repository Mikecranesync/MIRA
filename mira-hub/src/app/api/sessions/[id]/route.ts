import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/[id]
 *
 * Load a troubleshooting session by ID. Returns full transcript + context.
 * Tablet uses this to resume an in-flight session after a reload.
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
    const row = await withTenantContext<Record<string, unknown> | null>(ctx.tenantId, (c) =>
      c
        .query(
          `SELECT s.id, s.tenant_id, s.asset_id, s.component_id, s.technician_user_id,
                  s.channel, s.status, s.confirmed_at, s.resolved_at,
                  s.transcript, s.metadata, s.created_at, s.updated_at,
                  a.name AS asset_name, a.entity_id AS asset_tag_canonical,
                  i.component_name, i.plc_tag
             FROM troubleshooting_sessions s
             LEFT JOIN kg_entities a ON a.id = s.asset_id
             LEFT JOIN installed_component_instances i ON i.id = s.component_id
            WHERE s.tenant_id = $1 AND s.id = $2
            LIMIT 1`,
          [ctx.tenantId, id],
        )
        .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? null),
    );

    if (!row) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      session: {
        id: row.id,
        status: row.status,
        channel: row.channel,
        asset: row.asset_id
          ? { id: row.asset_id, name: row.asset_name, tag: row.asset_tag_canonical }
          : null,
        component: row.component_id
          ? { id: row.component_id, name: row.component_name, plc_tag: row.plc_tag }
          : null,
        confirmed_at: row.confirmed_at,
        resolved_at: row.resolved_at,
        transcript: row.transcript ?? [],
        metadata: row.metadata ?? {},
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error("[api/sessions/[id] GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
