import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { applyHubProposalTransition, type QueryClient } from "@/lib/proposal-transition";

// Shape of an ai_suggestions row for tag_mapping decisions.
interface TagSuggestionRow {
  id: string;
  status: string;
  extracted_data: Record<string, unknown>;
}

export const dynamic = "force-dynamic";

/**
 * Decide a relationship proposal: verify or reject.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
 * ADR : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md
 *
 * On `verify`:
 *   1. UPDATE relationship_proposals.status = 'verified', reviewed_by/_at.
 *   2. UPSERT into kg_relationships with approval_state='verified',
 *      proposed_by=p.created_by, evidence_summary=p.reasoning.
 *      A relationship between the same source/target/type is updated to
 *      verified; otherwise inserted.
 *
 * On `reject`:
 *   1. UPDATE relationship_proposals.status = 'rejected', reviewed_by/_at.
 *   No kg_relationships write.
 *
 * Body: { "decision": "verify" | "reject", "reason"?: string }
 *
 * Requires engine migration 008_kg_approval_state.sql (kg_relationships
 * needs approval_state, proposed_by, evidence_summary columns).
 */

interface ProposalRow {
  id: string;
  tenant_id: string | null;
  source_entity_id: string;
  source_entity_type: string;
  target_entity_id: string;
  target_entity_type: string;
  relationship_type: string;
  confidence: number;
  status: string;
  created_by: string;
  reasoning: string | null;
}

async function markDocumentChunksVerified(
  client: QueryClient,
  tenantId: string,
  proposal: ProposalRow,
): Promise<void> {
  if (proposal.relationship_type !== "HAS_DOCUMENT") return;

  const docRes = await client.query(
    `SELECT entity_id
       FROM kg_entities
      WHERE tenant_id = $1::uuid
        AND entity_type = 'manual'
        AND entity_id = $2
      LIMIT 1`,
    [tenantId, proposal.target_entity_id],
  );
  const entityId = String((docRes.rows[0] as { entity_id?: unknown } | undefined)?.entity_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) return;

  await client.query(
    `UPDATE knowledge_entries
        SET verified = true
      WHERE tenant_id = $1::uuid
        AND doc_id = $2::uuid
        AND verified IS DISTINCT FROM true`,
    [tenantId, entityId],
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const decision = (body.decision ?? "").toLowerCase();
  if (decision !== "verify" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be 'verify' or 'reject'" }, { status: 400 });
  }
  const reason = (body.reason ?? "").slice(0, 1000);

  try {
    const result = await withTenantContext(ctx.tenantId, async (c) => {
      // ── tag_mapping path ─────────────────────────────────────────────────
      // For tag_mapping suggestions the caller passes the ai_suggestions.id
      // (not a relationship_proposals.id). Check for this type first so the
      // existing kg_edge / relationship_proposals flow is unchanged.
      const tagSugRes = await c.query<TagSuggestionRow>(
        `SELECT id, status, extracted_data
           FROM ai_suggestions
          WHERE id = $1 AND tenant_id = $2 AND suggestion_type = 'tag_mapping'
          FOR UPDATE`,
        [id, ctx.tenantId],
      );
      if (tagSugRes.rows.length > 0) {
        const s = tagSugRes.rows[0];
        if (s.status !== "pending" && s.status !== "deferred") {
          return { kind: "wrong_state" as const, status: s.status };
        }
        const reviewerLabel = `human:${ctx.userId ?? ctx.tenantId}`;
        // ADR-0017: update ai_suggestions status through the canonical helper.
        // No relationshipProposalId for tag_mapping — only the ai_suggestions
        // row is touched here; tag_entities is updated below.
        await applyHubProposalTransition(c, {
          trigger: decision === "verify" ? "accept" : "reject",
          aiSuggestionId: id,
          reviewerLabel,
          reason,
        });

        // Materialize the tag_entities approval_state when the tag entity
        // already exists (production flow: tag_classifier creates tag_entities
        // row with approval_state='proposed', then writes ai_suggestions with
        // extracted_data.tag_entity_id). Seed rows without tag_entity_id are
        // recorded as decided in ai_suggestions only.
        const tagEntityId = s.extracted_data?.tag_entity_id;
        if (typeof tagEntityId === "string" && /^[0-9a-f-]{36}$/i.test(tagEntityId)) {
          const newApprovalState = decision === "verify" ? "verified" : "rejected";
          await c.query(
            `UPDATE tag_entities
                SET approval_state = $1, updated_at = now()
              WHERE id = $2 AND tenant_id = $3`,
            [newApprovalState, tagEntityId, ctx.tenantId],
          );
        }

        const newStatus = decision === "verify" ? "verified" : "rejected";
        return { kind: "ok" as const, decision, status: newStatus };
      }

      // ── kg_edge path (existing) ───────────────────────────────────────────
      const proposalRes = await c.query<ProposalRow>(
        `SELECT id, tenant_id, source_entity_id, source_entity_type,
                target_entity_id, target_entity_type, relationship_type,
                confidence, status, created_by, reasoning
         FROM relationship_proposals
         WHERE id = $1 AND tenant_id = $2::uuid
         FOR UPDATE`,
        [id, ctx.tenantId],
      );
      if (proposalRes.rows.length === 0) {
        return { kind: "not_found" as const };
      }
      const p = proposalRes.rows[0];

      if (p.status !== "proposed" && p.status !== "reviewed" && p.status !== "needs_review") {
        return { kind: "wrong_state" as const, status: p.status };
      }

      const newStatus = decision === "verify" ? "verified" : "rejected";
      const reviewerLabel = `human:${ctx.userId ?? ctx.tenantId}`;

      // ADR-0017: route the Hub-side projections through the single helper so
      // the paired ai_suggestions(kg_edge) row transitions in lockstep with
      // relationship_proposals (the drift the proposal-state canary detects).
      // kg_relationships (engine projection) is still mirrored below.
      await applyHubProposalTransition(c, {
        trigger: decision === "verify" ? "accept" : "reject",
        relationshipProposalId: id,
        reviewerLabel,
        reason,
      });

      if (decision === "verify") {
        await markDocumentChunksVerified(c, ctx.tenantId, p);

        // Engine-side mirror in kg_relationships. Insert if missing, else
        // bump approval_state. Source/target/type defines the edge identity.
        const existingRes = await c.query<{ id: string }>(
          `SELECT id FROM kg_relationships
            WHERE tenant_id = $1
              AND source_id = $2
              AND target_id = $3
              AND relationship_type = $4`,
          [ctx.tenantId, p.source_entity_id, p.target_entity_id, p.relationship_type],
        );
        if (existingRes.rows.length === 0) {
          await c.query(
            `INSERT INTO kg_relationships
               (tenant_id, source_id, target_id, relationship_type,
                confidence, approval_state, proposed_by, evidence_summary,
                relationship_proposal_id)
             VALUES ($1, $2, $3, $4, $5, 'verified', $6, $7, $8)`,
            [
              ctx.tenantId,
              p.source_entity_id,
              p.target_entity_id,
              p.relationship_type,
              p.confidence,
              p.created_by,
              p.reasoning,
              id,
            ],
          );
        } else {
          // Provenance link: record which proposal verified this edge (keep the
          // first link if one already exists). Makes the edge traceable back to
          // the human approval and the ADR-0017 canary's Check 2 load-bearing.
          await c.query(
            `UPDATE kg_relationships
                SET approval_state = 'verified',
                    confidence = GREATEST(confidence, $1),
                    proposed_by = COALESCE(proposed_by, $2),
                    evidence_summary = COALESCE(evidence_summary, $3),
                    relationship_proposal_id = COALESCE(relationship_proposal_id, $5)
              WHERE id = $4`,
            [p.confidence, p.created_by, p.reasoning, existingRes.rows[0].id, id],
          );
        }
      }

      return { kind: "ok" as const, decision, status: newStatus };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "proposal not found" }, { status: 404 });
    }
    if (result.kind === "wrong_state") {
      return NextResponse.json(
        { error: `cannot decide a proposal in '${result.status}' state` },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      id,
      decision: result.decision,
      status: result.status,
    });
  } catch (err) {
    console.error("[api/proposals/:id/decide POST]", err);
    return NextResponse.json({ error: "Decide failed" }, { status: 500 });
  }
}
