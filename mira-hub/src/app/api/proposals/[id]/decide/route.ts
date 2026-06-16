import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

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

      await c.query(
        `UPDATE relationship_proposals
           SET status = $1,
               reviewed_at = now(),
               reviewed_by = $2,
               reasoning = COALESCE(NULLIF($3, ''), reasoning)
         WHERE id = $4`,
        [newStatus, reviewerLabel, reason, id],
      );

      if (decision === "verify") {
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
