import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { computeHealthScore, type HealthScoreCounts } from "@/lib/health-score";

export const dynamic = "force-dynamic";

/**
 * Manual readiness recalculate. Same logic as GET /api/readiness, but
 * intended for the widget's refresh icon and for the slice-3 worker to
 * call after detecting stale rows.
 *
 * No body required. Returns the freshly-computed score.
 */

interface RawCountsRow {
  sites: string;
  lines: string;
  assets: string;
  components: string;
  docs: string;
  proposals_pending: string;
  proposals_verified: string;
  uns_paths: string;
  wizard_completed: boolean | null;
}

export async function POST() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const score = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<RawCountsRow>(
        `SELECT
            (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1 AND entity_type IN ('site','plant'))::text AS sites,
            (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1 AND entity_type IN ('line','production_line'))::text AS lines,
            (SELECT COUNT(*) FROM cmms_equipment WHERE tenant_id = $1)::text AS assets,
            (
              SELECT COUNT(*) FROM kg_entities
              WHERE tenant_id = $1 AND entity_type IN ('component','component_template')
            )::text AS components,
            (
              SELECT COUNT(DISTINCT source) FROM kg_triples_log WHERE tenant_id = $1
            )::text AS docs,
            (
              SELECT COUNT(*) FROM relationship_proposals
              WHERE tenant_id = $1 AND status = 'proposed'
            )::text AS proposals_pending,
            (
              SELECT COUNT(*) FROM relationship_proposals
              WHERE tenant_id = $1 AND status = 'verified'
            )::text AS proposals_verified,
            (
              SELECT COUNT(DISTINCT uns_path) FROM kg_entities WHERE tenant_id = $1 AND uns_path IS NOT NULL
            )::text AS uns_paths,
            (
              SELECT status = 'completed' FROM wizard_progress
              WHERE tenant_id = $1 AND wizard_kind = 'namespace_onboarding'
              ORDER BY updated_at DESC LIMIT 1
            ) AS wizard_completed`,
        [ctx.tenantId],
      );
      const counts: HealthScoreCounts = {
        sites: Number(res.rows[0].sites) || 0,
        lines: Number(res.rows[0].lines) || 0,
        assets: Number(res.rows[0].assets) || 0,
        components: Number(res.rows[0].components) || 0,
        docs: Number(res.rows[0].docs) || 0,
        proposalsPending: Number(res.rows[0].proposals_pending) || 0,
        proposalsVerified: Number(res.rows[0].proposals_verified) || 0,
        unsPaths: Number(res.rows[0].uns_paths) || 0,
        wizardCompleted: res.rows[0].wizard_completed === true,
      };
      const computed = computeHealthScore(counts);

      await c.query(
        `INSERT INTO health_scores
            (tenant_id, scope, scope_path, level, next_step, counts,
             computed_at, last_event_at, updated_at)
         VALUES ($1, 'tenant', '', $2, $3, $4::jsonb, now(), now(), now())
         ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
            SET level = EXCLUDED.level,
                next_step = EXCLUDED.next_step,
                counts = EXCLUDED.counts,
                computed_at = EXCLUDED.computed_at,
                last_event_at = EXCLUDED.last_event_at,
                updated_at = now()`,
        [ctx.tenantId, computed.level, computed.nextStep, JSON.stringify(counts)],
      );

      return { ...computed, counts };
    });

    return NextResponse.json({
      ...score,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/readiness/recalculate POST]", err);
    return NextResponse.json({ error: "Recalculate failed" }, { status: 500 });
  }
}
