#!/usr/bin/env bun
/**
 * Health-score recompute worker (Phase 2 slice 3).
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Readiness levels"
 * Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 2)
 *
 * Polls health_scores for stale rows (computed_at < NOW() - threshold) and
 * recomputes by hitting POST /api/readiness/recalculate impersonating each
 * tenant via the internal service token.
 *
 * Run on a cron (every 5 min in prod) — orchestration belongs to the deploy
 * surface, not this script. Local invocation:
 *
 *   bun run health-score:worker
 *
 * Env vars:
 *   NEON_DATABASE_URL       — Hub DB (required).
 *   HEALTH_STALENESS_MIN    — minutes before a row is considered stale.
 *                             Default 5.
 *   HEALTH_WORKER_BATCH     — max tenants processed per run. Default 50.
 *
 * Exit code: 0 on success (or no-op), 1 on any per-tenant failure (cron
 * surfaces failures but processes remaining tenants).
 */

import { Pool } from "pg";
import { computeHealthScore, type HealthScoreCounts } from "../src/lib/health-score";

const POOL_URL = process.env.NEON_DATABASE_URL;
if (!POOL_URL) {
  console.error("health-score-worker: NEON_DATABASE_URL is required");
  process.exit(2);
}

const STALENESS_MIN = Number(process.env.HEALTH_STALENESS_MIN ?? "5");
const BATCH = Number(process.env.HEALTH_WORKER_BATCH ?? "50");

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

async function recomputeOne(pool: Pool, tenantId: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE factorylm_app");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const res = await c.query<RawCountsRow>(
      `SELECT
          (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1 AND entity_type IN ('site','plant'))::text AS sites,
          (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1 AND entity_type IN ('line','production_line'))::text AS lines,
          (SELECT COUNT(*) FROM cmms_equipment WHERE tenant_id = $1)::text AS assets,
          (SELECT COUNT(*) FROM kg_entities WHERE tenant_id = $1 AND entity_type IN ('component','component_template'))::text AS components,
          (SELECT COUNT(DISTINCT source) FROM kg_triples_log WHERE tenant_id = $1)::text AS docs,
          (SELECT COUNT(*) FROM relationship_proposals WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'proposed')::text AS proposals_pending,
          (SELECT COUNT(*) FROM relationship_proposals WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'verified')::text AS proposals_verified,
          (SELECT COUNT(DISTINCT uns_path) FROM kg_entities WHERE tenant_id = $1 AND uns_path IS NOT NULL)::text AS uns_paths,
          (SELECT status = 'completed' FROM wizard_progress
            WHERE tenant_id = $1 AND wizard_kind = 'namespace_onboarding'
            ORDER BY updated_at DESC LIMIT 1) AS wizard_completed`,
      [tenantId],
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
    const score = computeHealthScore(counts);

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
      [tenantId, score.level, score.nextStep, JSON.stringify(counts)],
    );

    await c.query("COMMIT");
    console.log(
      `health-score-worker: tenant=${tenantId} level=${score.level} ` +
        `(assets=${counts.assets} comp=${counts.components} pending=${counts.proposalsPending} verified=${counts.proposalsVerified})`,
    );
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

async function findStaleTenants(pool: Pool): Promise<string[]> {
  // Two sources of work:
  //   1. Tenants whose cached health_scores row is older than threshold.
  //   2. Tenants that have at least one entity but no health_scores row yet.
  const c = await pool.connect();
  try {
    const res = await c.query<{ tenant_id: string }>(
      `WITH stale AS (
         SELECT tenant_id FROM health_scores
          WHERE scope = 'tenant'
            AND scope_path = ''
            AND computed_at < NOW() - ($1::text || ' minutes')::interval
       ),
       new_tenants AS (
         SELECT DISTINCT tenant_id FROM kg_entities
          WHERE tenant_id NOT IN (
            SELECT tenant_id FROM health_scores WHERE scope = 'tenant' AND scope_path = ''
          )
       )
       SELECT tenant_id FROM stale
       UNION
       SELECT tenant_id FROM new_tenants
       LIMIT $2`,
      [String(STALENESS_MIN), BATCH],
    );
    return res.rows.map((r) => r.tenant_id);
  } finally {
    c.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: POOL_URL });
  let failed = 0;
  try {
    const tenants = await findStaleTenants(pool);
    if (tenants.length === 0) {
      console.log("health-score-worker: no stale tenants — nothing to do");
      return;
    }
    console.log(`health-score-worker: recomputing ${tenants.length} tenant(s) (staleness ${STALENESS_MIN}m)`);
    for (const tenantId of tenants) {
      try {
        await recomputeOne(pool, tenantId);
      } catch (err) {
        failed++;
        console.error(`health-score-worker: tenant=${tenantId} failed:`, err);
      }
    }
  } finally {
    await pool.end();
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
