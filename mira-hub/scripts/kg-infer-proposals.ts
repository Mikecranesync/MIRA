#!/usr/bin/env bun
// Run: npx tsx scripts/kg-infer-proposals.ts --tenant-id <uuid>
/**
 * Inferred-relationship proposal worker (Phase 2 KG, Task 4).
 *
 * Reads tenant KG entities + work orders, runs the pure inference functions
 * (inferSameModelPairs / inferCoFailedPairs), and writes INFERRED
 * relationship_proposals (created_by='rule') via upsertInferredProposal.
 * All DB work for the tenant runs inside ONE tenant-context transaction so
 * RLS (app.tenant_id / factorylm_app role) is set for every query.
 *
 * Usage:
 *   npx tsx scripts/kg-infer-proposals.ts --tenant-id <uuid>
 *   bun run scripts/kg-infer-proposals.ts --tenant-id <uuid>
 *
 * Env vars required:
 *   NEON_DATABASE_URL — NeonDB connection string
 *
 * Exit codes:
 *   0 — success
 *   1 — missing args or runtime error
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import {
  inferSameModelPairs,
  inferCoFailedPairs,
  inferComponentManualPairs,
  type SameModelInput,
  type CoFailEvent,
  type ComponentInput,
  type ManualInput,
} from "@/lib/knowledge-graph/inference";
import { upsertInferredProposal } from "@/lib/knowledge-graph/proposals-writer";

// ── Transaction helper that sets both tenant settings (RLS) ───────────────
// Replicated from src/lib/knowledge-graph/cmms-sync.ts (the local withKgContext
// helper there is not exported), so this worker is self-contained.
async function withKgContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");

if (!tenantId) {
  console.error("Usage: npx tsx scripts/kg-infer-proposals.ts --tenant-id <uuid>");
  process.exit(1);
}

if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL environment variable is required");
  process.exit(1);
}

async function run(tenant: string): Promise<{ sameModel: [number, number]; coFailed: [number, number]; componentManual: [number, number] }> {
  return withKgContext(tenant, async (client) => {
    // ── 1. Same-model inference ──────────────────────────────────────────
    const eqRes = await client.query<{ id: string; manufacturer: string | null; model: string | null }>(
      `SELECT id, properties->>'manufacturer' AS manufacturer, properties->>'model_number' AS model
         FROM kg_entities
        WHERE tenant_id = $1 AND entity_type = 'equipment'`,
      [tenant],
    );
    const sameModelInputs: SameModelInput[] = eqRes.rows.map((r) => ({
      id: r.id,
      manufacturer: r.manufacturer,
      model: r.model,
    }));
    const sameModelPairs = inferSameModelPairs(sameModelInputs);

    let sameModelWritten = 0;
    for (const pair of sameModelPairs) {
      const id = await upsertInferredProposal(client, tenant, {
        sourceEntityId: pair.sourceId,
        sourceEntityType: "equipment",
        targetEntityId: pair.targetId,
        targetEntityType: "equipment",
        relationshipType: "SAME_MODEL_AS",
        confidence: 0.6,
        reasoning: `Identical manufacturer + model (${pair.key})`,
        evidence: [
          {
            evidenceType: "manifest",
            sourceDescription: "nameplate manufacturer+model match",
            confidenceContribution: 0.6,
          },
        ],
      });
      if (id !== null) sameModelWritten++;
    }

    // ── 2. Co-failed inference ───────────────────────────────────────────
    // Join work orders to their equipment's kg_entities UUID. cmms-sync.ts
    // creates the equipment entity with entity_id = String(cmms_equipment.id),
    // and the cmms-sync has_work_order join uses eqById.get(String(wo.equipment_id)),
    // so work_orders.equipment_id == cmms_equipment.id == kg_entities.entity_id.
    const woRes = await client.query<{ equipment_kg_id: string; at: string }>(
      `SELECT e.id AS equipment_kg_id, EXTRACT(EPOCH FROM wo.created_at)::bigint AS at
         FROM work_orders wo
         JOIN kg_entities e
           ON e.tenant_id = wo.tenant_id
          AND e.entity_type = 'equipment'
          AND e.entity_id = wo.equipment_id::text
        WHERE wo.tenant_id = $1 AND wo.equipment_id IS NOT NULL AND wo.created_at IS NOT NULL`,
      [tenant],
    );
    const events: CoFailEvent[] = woRes.rows.map((r) => ({
      equipmentId: r.equipment_kg_id,
      at: Number(r.at),
    }));
    const coFailedPairs = inferCoFailedPairs(events, 3600);

    let coFailedWritten = 0;
    for (const pair of coFailedPairs) {
      const id = await upsertInferredProposal(client, tenant, {
        sourceEntityId: pair.sourceId,
        sourceEntityType: "equipment",
        targetEntityId: pair.targetId,
        targetEntityType: "equipment",
        relationshipType: "CO_FAILED_WITH",
        confidence: Math.min(0.3 + 0.1 * pair.count, 0.8),
        reasoning: `Co-occurred in ${pair.count} work-order window(s)`,
        evidence: [
          {
            evidenceType: "work_order",
            sourceDescription: `${pair.count} co-occurrence(s) within 1h`,
            confidenceContribution: Math.min(0.1 * pair.count, 0.5),
          },
        ],
      });
      if (id !== null) coFailedWritten++;
    }

    // ── 3. Component → manual inference (HAS_DOCUMENT) ──────────────────
    const compRes = await client.query<{
      id: string;
      entity_type: string;
      manufacturer: string | null;
      model: string | null;
    }>(
      `SELECT id, entity_type,
              properties->>'manufacturer' AS manufacturer,
              properties->>'model_number' AS model
         FROM kg_entities
        WHERE tenant_id = $1 AND entity_type IN ('component', 'equipment')`,
      [tenant],
    );
    const entityTypeMap = new Map<string, string>(
      compRes.rows.map((r) => [r.id, r.entity_type]),
    );
    const componentInputs: ComponentInput[] = compRes.rows.map((r) => ({
      id: r.id,
      manufacturer: r.manufacturer,
      model: r.model,
    }));

    const manualRes = await client.query<{
      id: string;
      title: string | null;
      manufacturer: string | null;
      model: string | null;
    }>(
      `SELECT id, name AS title,
              properties->>'manufacturer' AS manufacturer,
              properties->>'model_number' AS model
         FROM kg_entities
        WHERE tenant_id = $1 AND entity_type = 'manual'`,
      [tenant],
    );
    const manualInputs: ManualInput[] = manualRes.rows.map((r) => ({
      id: r.id,
      manufacturer: r.manufacturer,
      model: r.model,
      title: r.title,
    }));

    const componentManualMatches = inferComponentManualPairs(componentInputs, manualInputs);

    let componentManualWritten = 0;
    for (const m of componentManualMatches) {
      const sourceEntityType = entityTypeMap.get(m.componentId) ?? "component";
      const id = await upsertInferredProposal(client, tenant, {
        sourceEntityId: m.componentId,
        sourceEntityType,
        targetEntityId: m.manualId,
        targetEntityType: "manual",
        relationshipType: "HAS_DOCUMENT",
        confidence: m.confidence,
        reasoning: m.reason,
        evidence: [
          {
            evidenceType: "oem_kb",
            sourceDescription: m.reason,
            confidenceContribution: m.confidence,
          },
        ],
      });
      if (id !== null) componentManualWritten++;
    }

    return {
      sameModel: [sameModelWritten, sameModelPairs.length],
      coFailed: [coFailedWritten, coFailedPairs.length],
      componentManual: [componentManualWritten, componentManualMatches.length],
    };
  });
}

try {
  const result = await run(tenantId);
  console.log(
    `[kg-infer] tenant=${tenantId} same_model: ${result.sameModel[0]}/${result.sameModel[1]}, ` +
      `co_failed: ${result.coFailed[0]}/${result.coFailed[1]}, ` +
      `component_manual: ${result.componentManual[0]}/${result.componentManual[1]}`,
  );
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error("[kg-infer] Fatal error:", err);
  await pool.end();
  process.exit(1);
}
