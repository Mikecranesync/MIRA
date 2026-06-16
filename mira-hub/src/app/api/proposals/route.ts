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
  total_count: number;
}

// ai_suggestions rows (mig 027). The 5 non-edge suggestion types — `kg_edge` is
// the header-on-a-relationship_proposals row already covered above, so it is
// excluded here to avoid double-rendering. ADR-0014 supersedes ADR-0013:
// /proposals MUST surface these. See issue #1663.
interface SuggestionRow {
  id: string;
  suggestion_type: string;
  title: string | null;
  body: string | null;
  confidence: number;
  status: string;
  risk_level: string;
  proposed_by: string;
  source_kind: string | null;
  source_document_id: string | null;
  source_page: number | null;
  created_at: string;
  total_count: number;
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

// relationship_proposals status vocab → ai_suggestions status vocab (mig 027
// CHECK: pending|accepted|rejected|deferred|superseded). Lets one `status`
// query param drive both stores.
const PROPOSAL_TO_SUGGESTION_STATUS: Record<string, string> = {
  proposed: "pending",
  reviewed: "deferred",
  verified: "accepted",
  rejected: "rejected",
  deprecated: "superseded",
  contradicted: "superseded",
};

// ── Paging helpers (pure, unit-tested — see route.test.ts) ──────────────────
// #1892: the old endpoint returned `total: rows.length` (the page size, not a
// real COUNT) and capped at 500 with no offset, so large queues were silently
// truncated and the tab badge undercounted. These keep the math in one place.

/** Clamp a raw ?limit into [1, HARD_LIMIT], default DEFAULT_LIMIT. */
export function clampLimit(raw: string | null): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), HARD_LIMIT);
}

/** Clamp a raw ?offset into [0, ∞), default 0. */
export function clampOffset(raw: string | null): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Real total comes back on every row as COUNT(*) OVER(); an empty page means
 *  zero matches. Reading row[0] avoids a second COUNT round-trip. */
export function readTotal(rows: Array<{ total_count?: number }>): number {
  return rows.length > 0 ? Number(rows[0].total_count) || 0 : 0;
}

/** Are there more rows beyond the current page? */
export function hasMorePage(offset: number, pageRows: number, total: number): boolean {
  return offset + pageRows < total;
}

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
    const countOnly = url.searchParams.get("count") != null;
    const limit = clampLimit(url.searchParams.get("limit"));
    const offset = clampOffset(url.searchParams.get("offset"));

    // ── shared WHERE for relationship_proposals (edge proposals) ──
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
    const propWhere = filters.join(" AND ");

    // ── shared WHERE for ai_suggestions (the 5 non-edge suggestion types) ──
    const sugFilters: string[] = [
      "s.tenant_id = $1::uuid",
      "s.suggestion_type <> 'kg_edge'",
    ];
    const sugParams: unknown[] = [ctx.tenantId];
    if (statusParam !== "all") {
      const sugStatuses = Array.from(
        new Set(
          statusParam
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => ALLOWED_STATUS.has(s))
            .map((s) => PROPOSAL_TO_SUGGESTION_STATUS[s])
            .filter(Boolean),
        ),
      );
      // statusParam was validated non-empty above and the mapping is total, so
      // sugStatuses is always non-empty here.
      sugParams.push(sugStatuses);
      sugFilters.push(`s.status = ANY($${sugParams.length})`);
    }
    const sugWhere = sugFilters.join(" AND ");

    // ai_suggestions is fail-soft everywhere: if the table is absent (mig 027 not
    // applied) or the query errors, fall back to 0/[] rather than 500 the whole
    // page — the edge-proposals path must keep working. See #1663.
    const countSuggestions = () =>
      withTenantContext(ctx.tenantId, (c) =>
        c
          .query<{ c: number }>(
            `SELECT COUNT(*)::int AS c FROM ai_suggestions s WHERE ${sugWhere}`,
            sugParams,
          )
          .then((r) => r.rows[0]?.c ?? 0),
      ).catch((err) => {
        console.error("[api/proposals GET] ai_suggestions count failed (soft)", err);
        return 0;
      });

    // ── count-only mode (#1892): cheap COUNTs for the tab badge — no row
    // hydration, no kg_entities joins, no per-row evidence subquery. ──
    if (countOnly) {
      const proposalsTotal = await withTenantContext(ctx.tenantId, (c) =>
        c
          .query<{ c: number }>(
            `SELECT COUNT(*)::int AS c FROM relationship_proposals p WHERE ${propWhere}`,
            params,
          )
          .then((r) => r.rows[0]?.c ?? 0),
      );
      const suggestionsTotal = await countSuggestions();
      return NextResponse.json({
        proposalsTotal,
        suggestionsTotal,
        pendingTotal: proposalsTotal + suggestionsTotal,
      });
    }

    // ── list mode: real total via COUNT(*) OVER() + offset paging (#1892) ──
    const listParams = [...params, limit, offset];
    const propLimitPh = `$${listParams.length - 1}`;
    const propOffsetPh = `$${listParams.length}`;

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
              p.created_at,
              COUNT(*) OVER()::int AS total_count
           FROM relationship_proposals p
           LEFT JOIN kg_entities src ON src.id = p.source_entity_id AND src.tenant_id = $1::uuid
           LEFT JOIN kg_entities tgt ON tgt.id = p.target_entity_id AND tgt.tenant_id = $1::uuid
           WHERE ${propWhere}
           ORDER BY
              CASE p.risk_level
                WHEN 'safety_critical' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                ELSE 3
              END,
              p.created_at DESC
           LIMIT ${propLimitPh} OFFSET ${propOffsetPh}`,
          listParams,
        )
        .then((r) => r.rows),
    );

    const sugListParams = [...sugParams, limit, offset];
    const sugLimitPh = `$${sugListParams.length - 1}`;
    const sugOffsetPh = `$${sugListParams.length}`;

    const suggestionRows: SuggestionRow[] = await withTenantContext(
      ctx.tenantId,
      (c) =>
        c
          .query<SuggestionRow>(
            `SELECT
                s.id,
                s.suggestion_type,
                s.title,
                s.body,
                s.confidence,
                s.status,
                s.risk_level,
                s.proposed_by,
                s.source_kind,
                s.source_document_id::text AS source_document_id,
                s.source_page,
                s.created_at,
                COUNT(*) OVER()::int AS total_count
             FROM ai_suggestions s
             WHERE ${sugWhere}
             ORDER BY
                CASE s.risk_level
                  WHEN 'safety_critical' THEN 0
                  WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2
                  ELSE 3
                END,
                s.created_at DESC
             LIMIT ${sugLimitPh} OFFSET ${sugOffsetPh}`,
            sugListParams,
          )
          .then((r) => r.rows),
    ).catch((err) => {
      console.error("[api/proposals GET] ai_suggestions query failed (soft)", err);
      return [];
    });

    const total = readTotal(rows);
    const suggestionsTotal = readTotal(suggestionRows);

    return NextResponse.json({
      proposals: rows.map(rowToProposal),
      total,
      hasMore: hasMorePage(offset, rows.length, total),
      suggestions: suggestionRows.map(rowToSuggestion),
      suggestionsTotal,
      suggestionsHasMore: hasMorePage(offset, suggestionRows.length, suggestionsTotal),
      filters: { status: statusParam, type: typeParam, limit, offset },
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

function rowToSuggestion(r: SuggestionRow) {
  return {
    id: r.id,
    suggestionType: r.suggestion_type,
    title: r.title,
    body: r.body,
    confidence: r.confidence,
    status: r.status,
    riskLevel: r.risk_level,
    createdBy: r.proposed_by,
    sourceKind: r.source_kind,
    sourceDocumentId: r.source_document_id,
    sourcePage: r.source_page,
    createdAt: r.created_at,
  };
}
