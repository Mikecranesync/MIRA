import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Relationship proposals — read-only for Phase 2 slice 1.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
 * ADR : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md
 *       (canonical source is `relationship_proposals` from mira-hub mig 018,
 *        NOT a duplicate `ai_suggestions` table.)
 *
 * Mutation endpoint (POST /api/proposals/:id/decide → promote to verified or
 * mark rejected) lands in slice 2 once the engine-side `kg_approval_state`
 * migration ships.
 *
 * Query params:
 *   status   — comma-separated subset of (proposed|reviewed|verified|rejected|deprecated|contradicted).
 *              Default: 'proposed'. Use 'all' to omit the filter.
 *   type     — comma-separated relationship_type filter (e.g. "HAS_COMPONENT,WIRED_TO").
 *              Default: no filter.
 *   limit    — max rows. Default 100, hard cap 500.
 */

interface ProposalRow {
  id: string;
  source_entity_id: string;
  source_entity_type: string;
  source_name: string | null;
  source_uns_path: string | null;
  target_entity_id: string;
  target_entity_type: string;
  target_name: string | null;
  target_uns_path: string | null;
  relationship_type: string;
  confidence: number;
  status: string;
  created_by: string;
  risk_level: string;
  requires_human_review: boolean;
  reasoning: string | null;
  evidence_count: string;
  created_at: string;
}

const DEFAULT_LIMIT = 100;
const HARD_LIMIT = 500;
const ALLOWED_STATUS = new Set([
  "proposed",
  "reviewed",
  "verified",
  "rejected",
  "deprecated",
  "contradicted",
]);

export async function GET(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const url = new URL(req.url);
    const statusParam = (url.searchParams.get("status") ?? "proposed").trim();
    const typeParam = url.searchParams.get("type");
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
      HARD_LIMIT,
    );

    const filters: string[] = ["p.tenant_id = $1::uuid"];
    const params: unknown[] = [ctx.tenantId];

    if (statusParam !== "all") {
      const statuses = statusParam
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => ALLOWED_STATUS.has(s));
      if (statuses.length === 0) {
        return NextResponse.json({ error: "invalid status filter" }, { status: 400 });
      }
      params.push(statuses);
      filters.push(`p.status = ANY($${params.length})`);
    }

    if (typeParam) {
      const types = typeParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (types.length > 0) {
        params.push(types);
        filters.push(`p.relationship_type = ANY($${params.length})`);
      }
    }

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;

    const rows = await withTenantContext(ctx.tenantId, (c) =>
      c
        .query<ProposalRow>(
          `SELECT
              p.id,
              p.source_entity_id,
              p.source_entity_type,
              src.name AS source_name,
              src.uns_path::text AS source_uns_path,
              p.target_entity_id,
              p.target_entity_type,
              tgt.name AS target_name,
              tgt.uns_path::text AS target_uns_path,
              p.relationship_type,
              p.confidence,
              p.status,
              p.created_by,
              p.risk_level,
              p.requires_human_review,
              p.reasoning,
              (SELECT COUNT(*) FROM relationship_evidence e WHERE e.proposal_id = p.id)::text AS evidence_count,
              p.created_at
           FROM relationship_proposals p
           LEFT JOIN kg_entities src ON src.id = p.source_entity_id AND src.tenant_id = $1::uuid
           LEFT JOIN kg_entities tgt ON tgt.id = p.target_entity_id AND tgt.tenant_id = $1::uuid
           WHERE ${filters.join(" AND ")}
           ORDER BY
              CASE p.risk_level
                WHEN 'safety_critical' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                ELSE 3
              END,
              p.created_at DESC
           LIMIT ${limitPlaceholder}`,
          params,
        )
        .then((r) => r.rows),
    );

    return NextResponse.json({
      proposals: rows.map(rowToProposal),
      total: rows.length,
      filters: { status: statusParam, type: typeParam, limit },
    });
  } catch (err) {
    console.error("[api/proposals GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function rowToProposal(r: ProposalRow) {
  return {
    id: r.id,
    source: {
      entityId: r.source_entity_id,
      entityType: r.source_entity_type,
      name: r.source_name,
      unsPath: r.source_uns_path,
    },
    target: {
      entityId: r.target_entity_id,
      entityType: r.target_entity_type,
      name: r.target_name,
      unsPath: r.target_uns_path,
    },
    relationshipType: r.relationship_type,
    confidence: r.confidence,
    status: r.status,
    createdBy: r.created_by,
    riskLevel: r.risk_level,
    requiresHumanReview: r.requires_human_review,
    reasoning: r.reasoning,
    evidenceCount: Number(r.evidence_count) || 0,
    createdAt: r.created_at,
  };
}
