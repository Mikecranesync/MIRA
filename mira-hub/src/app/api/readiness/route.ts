import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { computeHealthScore, type HealthScoreCounts } from "@/lib/health-score";

export const dynamic = "force-dynamic";

/**
 * Tenant-wide readiness score — read-on-demand for Phase 2 slice 1.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Readiness levels"
 *
 * Queries kg_entities, cmms_equipment, relationship_proposals, kg_triples_log
 * and wizard_progress, runs the pure calculator in src/lib/health-score.ts,
 * upserts the result into health_scores (mig 021), and returns it.
 *
 * The event-driven recompute worker lands in slice 3; for slice 1 every
 * request recomputes. Cheap on the demo tenant; we'll cache + invalidate
 * when load grows.
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

export async function GET() {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const counts = await withTenantContext(ctx.tenantId, async (c) => {
      const res = await c.query<RawCountsRow>(
        `SELECT
            (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1::uuid AND entity_type IN ('site','plant'))::text AS sites,
            (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1::uuid AND entity_type IN ('line','production_line'))::text AS lines,
            (
              SELECT COUNT(*) FROM cmms_equipment WHERE tenant_id = $1::text
            )::text AS assets,
            (
              SELECT COUNT(*) FROM kg_entities
              WHERE tenant_id = $1::uuid AND entity_type IN ('component','component_template')
            )::text AS components,
            (
              SELECT COUNT(DISTINCT source) FROM kg_triples_log WHERE tenant_id = $1::uuid
            )::text AS docs,
            (
              SELECT COUNT(*) FROM relationship_proposals
              WHERE tenant_id = $1::uuid AND status = 'proposed'
            )::text AS proposals_pending,
            (
              SELECT COUNT(*) FROM relationship_proposals
              WHERE tenant_id = $1::uuid AND status = 'verified'
            )::text AS proposals_verified,
            (
              SELECT COUNT(DISTINCT uns_path) FROM kg_entities WHERE tenant_id = $1::uuid AND uns_path IS NOT NULL
            )::text AS uns_paths,
            (
              SELECT status = 'completed' FROM wizard_progress
              WHERE tenant_id = $1::uuid AND wizard_kind = 'namespace_onboarding'
              ORDER BY updated_at DESC LIMIT 1
            ) AS wizard_completed`,
        [ctx.tenantId],
      );
      return res.rows[0];
    });

    const numericCounts: HealthScoreCounts = {
      sites: Number(counts.sites) || 0,
      lines: Number(counts.lines) || 0,
      assets: Number(counts.assets) || 0,
      components: Number(counts.components) || 0,
      docs: Number(counts.docs) || 0,
      proposalsPending: Number(counts.proposals_pending) || 0,
      proposalsVerified: Number(counts.proposals_verified) || 0,
      unsPaths: Number(counts.uns_paths) || 0,
      wizardCompleted: counts.wizard_completed === true,
    };

    const score = computeHealthScore(numericCounts);

    // Write-through into health_scores so the (future) feed widget can read a
    // cached row instead of re-running the aggregation on every visit. Best-
    // effort — a write failure does NOT fail the API response.
    void persistScore(ctx.tenantId, score, numericCounts).catch((err) => {
      console.error("[api/readiness write-through]", err);
    });

    return NextResponse.json({
      ...score,
      counts: numericCounts,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/readiness GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

async function persistScore(
  tenantId: string,
  score: ReturnType<typeof computeHealthScore>,
  counts: HealthScoreCounts,
): Promise<void> {
  await withTenantContext(tenantId, (c) =>
    c.query(
      `INSERT INTO health_scores
         (tenant_id, scope, scope_path, level, next_step, counts, computed_at, last_event_at, updated_at)
       VALUES ($1::uuid, 'tenant', '', $2, $3, $4::jsonb, now(), now(), now())
       ON CONFLICT (tenant_id, scope, scope_path) DO UPDATE
         SET level = EXCLUDED.level,
             next_step = EXCLUDED.next_step,
             counts = EXCLUDED.counts,
             computed_at = EXCLUDED.computed_at,
             last_event_at = EXCLUDED.last_event_at,
             updated_at = now()`,
      [tenantId, score.level, score.nextStep, JSON.stringify(counts)],
    ),
  );
}
