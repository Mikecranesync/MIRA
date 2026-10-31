/**
 * Resolve the CMMS work order a `fix_recorded` delivery should write to, from
 * the tenant's write policy (#5020). Two shapes:
 *   - `work_order` — the policy names an external work order id directly.
 *   - `asset_linked_work_order` — resolve the newest work order already
 *     linked (via `work_orders.equipment_id`) to the notebook's bound asset.
 *
 * The `legacy_push_pending` outcome exists because `work_orders` already has
 * an independent NeonDB→Atlas forward-sync worker (`src/lib/atlas/sync.ts`)
 * that owns pushing a row's FIRST sync (`cmms_synced_at IS NULL OR
 * cmms_synced_at < updated_at`). If that row hasn't synced yet, its `atlas_id`
 * may not even be live on the Atlas side — writing a work-log comment to it
 * now would race that worker. So: no sync yet → wait, don't write.
 *
 * NOTE ON THE TEST SCHEMA: `work_orders` is a production table altered (not
 * created) by `db/migrations/007_atlas_sync_cols.sql` — its base `CREATE
 * TABLE` predates migration 001 and isn't tracked in this directory at all
 * (see `mira-hub/AGENTS.md`). It does not exist in the disposable test
 * schema either. The integration test's `beforeAll` must create a minimal
 * stand-in:
 *   CREATE TABLE IF NOT EXISTS work_orders (
 *     id uuid primary key default gen_random_uuid(),
 *     tenant_id text not null,
 *     equipment_id uuid,
 *     atlas_id text,
 *     updated_at timestamptz not null default now(),
 *     cmms_synced_at timestamptz
 *   );
 */
import type { PoolClient } from "pg";
import type { WorkOrderTarget } from "@/lib/cmms/write-contract";
import type { WritePolicy } from "./types";

export type ResolveWorkOrderTargetArgs = {
  tenantId: string;
  provider: string;
  policy: WritePolicy;
  equipmentEntityId: string | null;
};

export type ResolveWorkOrderTargetResult =
  | { ok: true; target: WorkOrderTarget; source: "policy_work_order" | "asset_linked_work_order" }
  | { ok: false; reason: "no_target" | "unbound_asset" | "legacy_push_pending" };

export async function resolveWorkOrderTarget(
  c: PoolClient,
  args: ResolveWorkOrderTargetArgs,
): Promise<ResolveWorkOrderTargetResult> {
  const target = args.policy.fixRecorded.target;
  if (!target) return { ok: false, reason: "no_target" };

  if (target.kind === "work_order") {
    return {
      ok: true,
      target: { providerId: args.provider, externalWorkOrderId: target.externalWorkOrderId },
      source: "policy_work_order",
    };
  }

  // kind === "asset_linked_work_order"
  if (!args.equipmentEntityId) return { ok: false, reason: "unbound_asset" };

  const res = await c.query<{
    id: string;
    atlas_id: string | null;
    updated_at: string;
    cmms_synced_at: string | null;
  }>(
    `SELECT id, atlas_id, updated_at, cmms_synced_at FROM work_orders
      WHERE tenant_id = $1::text AND equipment_id::text = $2 AND atlas_id IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [args.tenantId, args.equipmentEntityId],
  );
  const row = res.rows[0];
  if (!row || !row.atlas_id) return { ok: false, reason: "no_target" };

  const syncedAt = row.cmms_synced_at ? new Date(row.cmms_synced_at) : null;
  const updatedAt = new Date(row.updated_at);
  if (!syncedAt || syncedAt.getTime() < updatedAt.getTime()) {
    return { ok: false, reason: "legacy_push_pending" };
  }

  return {
    ok: true,
    target: { providerId: args.provider, externalWorkOrderId: row.atlas_id },
    source: "asset_linked_work_order",
  };
}
