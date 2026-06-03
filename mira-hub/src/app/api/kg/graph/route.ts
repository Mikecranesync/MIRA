// src/app/api/kg/graph/route.ts
/**
 * GET /api/kg/graph — live {nodes, links} for the caller's tenant.
 *
 * Reads kg_entities + kg_relationships and returns the force-graph payload
 * for the /hub/graph page. Session-authed (NOT the service-token internal
 * KG endpoint). Full-tenant graph for now; neighborhood/proposal edges are
 * Phase 2 (see design spec).
 *
 * Query params:
 *   types — optional comma-separated entity_type allow-list (e.g. "equipment,manual").
 */
import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { buildGraphPayload, type EntityRow, type RelRow } from "@/lib/knowledge-graph/graph-view";

export const dynamic = "force-dynamic";

const NODE_CAP = 5000;
const EDGE_CAP = 20000;

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("types");
  const includeProposals = url.searchParams.get("includeProposals") === "true";

  try {
    const { entities, rels } = await withTenantContext(ctx.tenantId, async (c) => {
      const e = await c.query<EntityRow>(
        `SELECT id, entity_type, name, uns_path::text AS uns_path
           FROM kg_entities
          WHERE tenant_id = $1::uuid
          LIMIT $2`,
        [ctx.tenantId, NODE_CAP],
      );
      const r = await c.query<RelRow>(
        includeProposals
          ? `SELECT source_id, target_id, relationship_type, confidence, approval_state, NULL::uuid AS proposal_id
               FROM kg_relationships
              WHERE tenant_id = $1::uuid
             UNION ALL
             SELECT source_entity_id, target_entity_id, relationship_type, confidence, 'proposed' AS approval_state, id AS proposal_id
               FROM relationship_proposals
              WHERE tenant_id = $1::uuid AND status = 'proposed'
             LIMIT $2`
          : `SELECT source_id, target_id, relationship_type, confidence, approval_state, NULL::uuid AS proposal_id
               FROM kg_relationships
              WHERE tenant_id = $1::uuid
             LIMIT $2`,
        [ctx.tenantId, EDGE_CAP],
      );
      return { entities: e.rows, rels: r.rows };
    });

    let payload = buildGraphPayload(entities, rels);

    if (typeParam) {
      const types = new Set(typeParam.split(",").map((s) => s.trim()).filter(Boolean));
      const keep = new Set(payload.nodes.filter((n) => types.has(n.type)).map((n) => n.id));
      payload = {
        nodes: payload.nodes.filter((n) => keep.has(n.id)),
        links: payload.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
      };
    }

    return NextResponse.json({
      ...payload,
      capped: entities.length >= NODE_CAP || rels.length >= EDGE_CAP,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
