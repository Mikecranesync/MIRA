// NeonDB ↔ Atlas CMMS sync engine.
//
// Architecture (see docs/specs/hub-cmms-integration-spec.md §4):
//
//   Hub UI (Next.js)                     Atlas GUI (vendored OSS)
//        │                                      │
//        │ writes                               │ writes
//        ▼                                      ▼
//   ┌─────────────┐  forward push  ──►  ┌───────────────┐
//   │ NeonDB (SoT)│ ◄── reverse poll ── │ Atlas Postgres│
//   └─────────────┘                     └───────────────┘
//
// Forward sync (NeonDB → Atlas):
//   Selects rows where cmms_synced_at IS NULL OR cmms_synced_at < updated_at.
//   For each row, calls Atlas POST (no atlas_id) or PATCH (atlas_id present).
//   On success: writes back atlas_id, cmms_synced_at = NOW(), cmms_synced_etag.
//
// Reverse sync (Atlas → NeonDB):
//   Polls Atlas /<resource>/search filtered by updatedAt > checkpoint.
//   For each Atlas row:
//     - find local row by atlas_id
//     - if local is unchanged since last push (updated_at <= cmms_synced_at):
//         accept the Atlas change → UPDATE local row, refresh sync columns
//     - else: NeonDB wins, log to cmms_sync_conflicts for review
//   - if local row not found: insert new (with atlas_id populated immediately)
//
// Tenant scoping: the worker uses a BYPASSRLS connection (pool default,
// neondb_owner) and explicitly filters every query by tenant_id. We do not
// rely on app.tenant_id RLS since the worker iterates ALL tenants per tick.
//
// Multi-tenancy caveat: as of P1, all tenants share the env-level Atlas
// credentials (ATLAS_API_USER/PASSWORD). The worker honors CMMS_SYNC_ENABLED
// — if false, every function is a no-op. Flip this only when one paying
// tenant is in scope, OR per-tenant Atlas provisioning has shipped (see
// `docs/plans/2026-04-10-factorylm-cmms-rebrand.md` Phase 1).

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import {
  AtlasClient,
  AtlasHttpError,
  type AtlasAsset,
  type AtlasPM,
  type AtlasWorkOrder,
  priorityHubToAtlas,
  statusHubToAtlas,
  statusAtlasToHub,
  priorityAtlasToHub,
} from "@/lib/atlas/client";

export interface SyncStats {
  pushed: number;
  updated: number;
  pulled: number;
  conflicts: number;
  errors: number;
}

export const ZERO_STATS: SyncStats = { pushed: 0, updated: 0, pulled: 0, conflicts: 0, errors: 0 };

export function syncEnabled(): boolean {
  return (process.env.CMMS_SYNC_ENABLED ?? "false").toLowerCase() === "true";
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function etagOf(atlasRow: { updatedAt?: string; id?: number }): string {
  // Cheap version marker. Atlas returns updatedAt as ISO string; if absent,
  // fall back to the ID + the current wall clock so we still write SOMETHING
  // and the next tick will re-converge.
  return atlasRow.updatedAt ?? `${atlasRow.id ?? ""}@${Date.now()}`;
}

async function withWorkerClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ─── Atlas free-tier quota breaker ────────────────────────────────────────────
// Atlas rejects new work orders past the free-tier cap ("You need a license to
// add a new work order. Free Limit of 30 incomplete work orders reached") with a
// 4xx. That is a standing condition, not a transient error — retrying the whole
// backlog every tick floods both this worker's log and the Atlas backend's
// stack-trace log (the May 2026 9.8 GB-log / 37 %-CPU incident). We detect it,
// stop the batch, and skip forward WO push for an exponentially-growing cooldown
// until incomplete-WO capacity frees up.

const QUOTA_ERROR_RE = /licen[cs]e|free limit|incomplete work orders/i;

export function isQuotaError(err: unknown): err is AtlasHttpError {
  return (
    err instanceof AtlasHttpError &&
    err.status >= 400 &&
    err.status < 500 &&
    QUOTA_ERROR_RE.test(err.body)
  );
}

const WO_BREAKER_BASE_COOLDOWN_MS = 5 * 60_000; // first trip pauses 5 min
const WO_BREAKER_MAX_COOLDOWN_MS = 60 * 60_000; // cap the backoff at 1 h

// Exponential-backoff breaker. `now` is injected so it is deterministically
// testable; callers pass Date.now().
export function createCooldownBreaker(
  baseMs = WO_BREAKER_BASE_COOLDOWN_MS,
  maxMs = WO_BREAKER_MAX_COOLDOWN_MS,
) {
  let trips = 0;
  let skipUntil = 0;
  return {
    isOpen: (now: number) => now < skipUntil,
    remainingMs: (now: number) => Math.max(0, skipUntil - now),
    /** Trip the breaker; returns the cooldown applied, in ms. */
    trip: (now: number) => {
      trips += 1;
      skipUntil = now + Math.min(baseMs * 2 ** (trips - 1), maxMs);
      return skipUntil - now;
    },
    reset: () => {
      trips = 0;
      skipUntil = 0;
    },
  };
}

// Module-level breaker shared across ticks (the worker calls runForwardSync once
// per tick inside one long-lived process).
// TODO(per-tenant): key woBreaker by Atlas base URL once per-tenant Atlas
// provisioning ships — today all tenants share one Atlas instance (one quota),
// so a single global breaker is correct; after that, one tenant hitting its cap
// would wrongly pause forward WO push for every tenant.
const woBreaker = createCooldownBreaker();

// ─── Forward sync: Assets (NeonDB → Atlas) ────────────────────────────────────
// Assets MUST be pushed before WOs because a WO's `asset.id` reference is the
// Atlas-side numeric ID, only known after the asset's first push.

interface PendingEquipment {
  id: string;
  tenant_id: string;
  atlas_id: string | null;
  equipment_number: string | null;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  description: string | null;
}

async function pushPendingAssets(c: PoolClient, atlas: AtlasClient): Promise<SyncStats> {
  const stats = { ...ZERO_STATS };
  const { rows } = await c.query<PendingEquipment>(
    `SELECT id, tenant_id, atlas_id,
            equipment_number, manufacturer, model_number, serial_number, description
     FROM cmms_equipment
     WHERE cmms_synced_at IS NULL
        OR cmms_synced_at < updated_at
     ORDER BY created_at ASC
     LIMIT 100`,
  );

  for (const row of rows) {
    const fallbackName =
      row.description ||
      [row.manufacturer, row.model_number].filter(Boolean).join(" ") ||
      row.equipment_number ||
      "Asset";
    const payload = {
      name: fallbackName,
      description: row.description ?? "",
      manufacturer: row.manufacturer ?? "",
      model: row.model_number ?? "",
      serialNumber: row.serial_number ?? "",
    };

    try {
      let atlasRow: AtlasAsset;
      if (!row.atlas_id) {
        atlasRow = await atlas.createAsset(payload);
        stats.pushed++;
      } else {
        atlasRow = await atlas.updateAsset(row.atlas_id, payload);
        stats.updated++;
      }
      const atlasId = String(atlasRow.id);
      const etag = etagOf(atlasRow);
      await c.query(
        `UPDATE cmms_equipment
         SET atlas_id = $1, cmms_synced_at = NOW(), cmms_synced_etag = $2
         WHERE id = $3 AND tenant_id = $4`,
        [atlasId, etag, row.id, row.tenant_id],
      );
    } catch (err) {
      stats.errors++;
      if (isQuotaError(err)) {
        console.warn(`[cmms-sync] asset push stopped — Atlas quota/license limit: ${(err as AtlasHttpError).message}`);
        break;
      }
      console.error(`[cmms-sync] asset push failed id=${row.id}:`, err instanceof Error ? err.message : err);
      if (err instanceof AtlasHttpError && err.status >= 500) break; // back off on Atlas down
    }
  }
  return stats;
}

// ─── Forward sync: Work orders (NeonDB → Atlas) ───────────────────────────────

interface PendingWorkOrder {
  id: string;
  tenant_id: string;
  atlas_id: string | null;
  title: string | null;
  description: string | null;
  fault_description: string | null;
  resolution: string | null;
  priority: string | null;
  status: string | null;
  equipment_id: string | null;
  equipment_atlas_id: string | null;
}

async function pushPendingWorkOrders(c: PoolClient, atlas: AtlasClient): Promise<SyncStats> {
  const stats = { ...ZERO_STATS };
  if (woBreaker.isOpen(Date.now())) {
    console.warn(
      `[cmms-sync] forward WO push paused (Atlas free-tier quota) — retrying in ` +
        `${Math.ceil(woBreaker.remainingMs(Date.now()) / 60_000)}m.`,
    );
    return stats;
  }
  const { rows } = await c.query<PendingWorkOrder>(
    `SELECT wo.id, wo.tenant_id, wo.atlas_id,
            wo.title, wo.description, wo.fault_description, wo.resolution,
            wo.priority::text AS priority, wo.status::text AS status,
            wo.equipment_id, eq.atlas_id AS equipment_atlas_id
     FROM work_orders wo
     LEFT JOIN cmms_equipment eq ON eq.id = wo.equipment_id
     WHERE wo.cmms_synced_at IS NULL
        OR wo.cmms_synced_at < wo.updated_at
     ORDER BY wo.created_at ASC
     LIMIT 100`,
  );

  for (const row of rows) {
    // Skip if WO references an asset that hasn't been pushed yet — assets are
    // pushed earlier in the same tick, so this should be rare. Next tick will
    // pick it up.
    if (row.equipment_id && !row.equipment_atlas_id) {
      continue;
    }

    const description = [row.fault_description, row.description, row.resolution]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const payload = {
      title: row.title ?? "Work Order",
      description: description || "(no description)",
      priority: priorityHubToAtlas(row.priority),
      status: statusHubToAtlas(row.status),
      ...(row.equipment_atlas_id
        ? { asset: { id: Number(row.equipment_atlas_id) } }
        : {}),
    };

    try {
      let atlasRow: AtlasWorkOrder;
      if (!row.atlas_id) {
        atlasRow = await atlas.createWorkOrder(payload);
        stats.pushed++;
      } else {
        atlasRow = await atlas.updateWorkOrder(row.atlas_id, payload);
        stats.updated++;
      }
      const atlasId = String(atlasRow.id);
      const etag = etagOf(atlasRow);
      await c.query(
        `UPDATE work_orders
         SET atlas_id = $1, cmms_synced_at = NOW(), cmms_synced_etag = $2
         WHERE id = $3 AND tenant_id = $4`,
        [atlasId, etag, row.id, row.tenant_id],
      );
      woBreaker.reset(); // capacity confirmed — clear any prior quota cooldown
    } catch (err) {
      stats.errors++;
      if (isQuotaError(err)) {
        const pausedMs = woBreaker.trip(Date.now());
        console.warn(
          `[cmms-sync] Atlas free-tier WO quota reached — pausing forward WO push for ` +
            `${Math.ceil(pausedMs / 60_000)}m. (${(err as AtlasHttpError).message})`,
        );
        break;
      }
      console.error(`[cmms-sync] wo push failed id=${row.id}:`, err instanceof Error ? err.message : err);
      if (err instanceof AtlasHttpError && err.status >= 500) break;
    }
  }
  return stats;
}

// ─── Forward sync: PM schedules (NeonDB → Atlas) ──────────────────────────────

interface PendingPM {
  id: string;
  tenant_id: string;
  atlas_id: string | null;
  task: string | null;
  manufacturer: string | null;
  model_number: string | null;
  equipment_id: string | null;
  equipment_atlas_id: string | null;
  source_citation: string | null;
}

async function pushPendingPMs(c: PoolClient, atlas: AtlasClient): Promise<SyncStats> {
  const stats = { ...ZERO_STATS };

  // pm_schedules may not exist in every environment — guard with a table
  // existence check so the worker doesn't error in dev databases.
  const exists = await c.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'pm_schedules'
     ) AS exists`,
  );
  if (!exists.rows[0]?.exists) return stats;

  const { rows } = await c.query<PendingPM>(
    `SELECT pm.id, pm.tenant_id, pm.atlas_id,
            pm.task, pm.manufacturer, pm.model_number,
            pm.equipment_id, eq.atlas_id AS equipment_atlas_id,
            pm.source_citation
     FROM pm_schedules pm
     LEFT JOIN cmms_equipment eq ON eq.id = pm.equipment_id
     WHERE pm.cmms_synced_at IS NULL
        OR pm.cmms_synced_at < pm.updated_at
     ORDER BY pm.created_at ASC
     LIMIT 100`,
  );

  for (const row of rows) {
    if (row.equipment_id && !row.equipment_atlas_id) continue;
    const title = `PM: ${row.task ?? "task"} — ${row.manufacturer ?? ""} ${row.model_number ?? ""}`.trim();
    const description = row.source_citation ?? "Auto-generated PM schedule.";

    const payload = {
      title,
      description,
      ...(row.equipment_atlas_id ? { asset: { id: Number(row.equipment_atlas_id) } } : {}),
    };

    try {
      let atlasRow: AtlasPM;
      if (!row.atlas_id) {
        atlasRow = await atlas.createPM(payload);
        stats.pushed++;
      } else {
        atlasRow = await atlas.updatePM(row.atlas_id, payload);
        stats.updated++;
      }
      await c.query(
        `UPDATE pm_schedules
         SET atlas_id = $1, cmms_synced_at = NOW(), cmms_synced_etag = $2
         WHERE id = $3 AND tenant_id = $4`,
        [String(atlasRow.id), etagOf(atlasRow), row.id, row.tenant_id],
      );
    } catch (err) {
      stats.errors++;
      if (isQuotaError(err)) {
        console.warn(`[cmms-sync] pm push stopped — Atlas quota/license limit: ${(err as AtlasHttpError).message}`);
        break;
      }
      console.error(`[cmms-sync] pm push failed id=${row.id}:`, err instanceof Error ? err.message : err);
      if (err instanceof AtlasHttpError && err.status >= 500) break;
    }
  }
  return stats;
}

// ─── Forward sync orchestrator ────────────────────────────────────────────────

export async function runForwardSync(atlas?: AtlasClient): Promise<SyncStats> {
  if (!syncEnabled()) {
    console.log("[cmms-sync] CMMS_SYNC_ENABLED=false — forward sync is a no-op.");
    return { ...ZERO_STATS };
  }

  const client = atlas ?? new AtlasClient();
  if (!client.configured) {
    console.warn("[cmms-sync] Atlas client unconfigured — skipping forward sync.");
    return { ...ZERO_STATS };
  }

  return withWorkerClient(async (c) => {
    const totals: SyncStats = { ...ZERO_STATS };
    const passes: Array<[string, () => Promise<SyncStats>]> = [
      ["assets", () => pushPendingAssets(c, client)],
      ["work_orders", () => pushPendingWorkOrders(c, client)],
      ["pm_schedules", () => pushPendingPMs(c, client)],
    ];
    for (const [label, fn] of passes) {
      const s = await fn();
      console.log(`[cmms-sync] forward ${label}: pushed=${s.pushed} updated=${s.updated} errors=${s.errors}`);
      totals.pushed += s.pushed;
      totals.updated += s.updated;
      totals.errors += s.errors;
    }
    return totals;
  });
}

// ─── Reverse sync: Atlas → NeonDB ─────────────────────────────────────────────
// Polls Atlas /<resource>/search filtered by updatedAt > checkpoint stored in
// cmms_sync_state. We don't yet support per-tenant Atlas filtering — Atlas
// returns the same admin-account view to every tenant in this single-tenant
// configuration. When per-tenant creds ship, this loop becomes tenant-scoped.

type ReverseResource = "work_orders" | "assets" | "preventive_maintenances";

const ROOT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

async function getCheckpoint(c: PoolClient, resource: ReverseResource): Promise<Date> {
  const { rows } = await c.query<{ last_poll_at: string }>(
    `SELECT last_poll_at::text FROM cmms_sync_state
     WHERE tenant_id = $1 AND resource = $2`,
    [ROOT_TENANT_ID, resource],
  );
  return rows[0] ? new Date(rows[0].last_poll_at) : new Date(0);
}

async function setCheckpoint(c: PoolClient, resource: ReverseResource, when: Date): Promise<void> {
  await c.query(
    `INSERT INTO cmms_sync_state (tenant_id, resource, last_poll_at, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, resource)
     DO UPDATE SET last_poll_at = EXCLUDED.last_poll_at, updated_at = NOW()`,
    [ROOT_TENANT_ID, resource, when.toISOString()],
  );
}

async function logConflict(
  c: PoolClient,
  resource: ReverseResource,
  neondbId: string | null,
  atlasId: string,
  payload: unknown,
  reason: string,
  tenantId: string | null,
): Promise<void> {
  await c.query(
    `INSERT INTO cmms_sync_conflicts (tenant_id, resource, neondb_id, atlas_id, atlas_payload, reason)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [tenantId ?? ROOT_TENANT_ID, resource, neondbId, atlasId, JSON.stringify(payload), reason],
  );
}

async function pullAtlasWorkOrders(c: PoolClient, atlas: AtlasClient): Promise<SyncStats> {
  const stats = { ...ZERO_STATS };
  const since = await getCheckpoint(c, "work_orders");
  const sinceIso = since.toISOString();

  let pageNum = 0;
  const pageSize = 50;
  let maxSeen = since;

  for (; pageNum < 20; pageNum++) {
    const resp = await atlas.searchWorkOrders({ pageSize, pageNum, updatedAt: sinceIso });
    const items = resp.content ?? [];
    if (items.length === 0) break;

    for (const a of items) {
      const atlasId = String(a.id);
      const updatedAt = a.updatedAt ? new Date(a.updatedAt) : new Date();
      if (updatedAt > maxSeen) maxSeen = updatedAt;

      // Find the matching NeonDB row by atlas_id (any tenant).
      const found = await c.query<{
        id: string;
        tenant_id: string;
        updated_at: string;
        cmms_synced_at: string | null;
      }>(
        `SELECT id, tenant_id, updated_at::text, cmms_synced_at::text
         FROM work_orders WHERE atlas_id = $1 LIMIT 1`,
        [atlasId],
      );
      const local = found.rows[0];

      if (!local) {
        // Atlas-only row — likely created directly in the Atlas GUI. We don't
        // have the tenant context to insert, so log as orphan for review.
        await logConflict(c, "work_orders", null, atlasId, a, "orphan_atlas_id", null);
        stats.conflicts++;
        continue;
      }

      const localUpdated = new Date(local.updated_at);
      const lastSynced = local.cmms_synced_at ? new Date(local.cmms_synced_at) : new Date(0);
      if (localUpdated > lastSynced) {
        // NeonDB writer raced after our last push — NeonDB wins.
        await logConflict(c, "work_orders", local.id, atlasId, a, "neondb_newer", local.tenant_id);
        stats.conflicts++;
        continue;
      }

      // Accept the Atlas change.
      await c.query(
        `UPDATE work_orders
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             status = COALESCE($3, status::text)::workorderstatus,
             priority = COALESCE($4, priority::text)::prioritylevel,
             cmms_synced_at = NOW(),
             cmms_synced_etag = $5,
             updated_at = NOW()
         WHERE id = $6 AND tenant_id = $7`,
        [
          a.title ?? null,
          a.description ?? null,
          a.status ? statusAtlasToHub(a.status) : null,
          a.priority ? priorityAtlasToHub(a.priority) : null,
          etagOf(a),
          local.id,
          local.tenant_id,
        ],
      );
      stats.pulled++;
    }

    if (items.length < pageSize) break;
  }

  await setCheckpoint(c, "work_orders", maxSeen);
  return stats;
}

async function pullAtlasAssets(c: PoolClient, atlas: AtlasClient): Promise<SyncStats> {
  const stats = { ...ZERO_STATS };
  const since = await getCheckpoint(c, "assets");
  const sinceIso = since.toISOString();
  let pageNum = 0;
  const pageSize = 50;
  let maxSeen = since;

  for (; pageNum < 20; pageNum++) {
    const resp = await atlas.searchAssets({ pageSize, pageNum, updatedAt: sinceIso });
    const items = resp.content ?? [];
    if (items.length === 0) break;

    for (const a of items) {
      const atlasId = String(a.id);
      const updatedAt = a.updatedAt ? new Date(a.updatedAt) : new Date();
      if (updatedAt > maxSeen) maxSeen = updatedAt;

      const found = await c.query<{
        id: string;
        tenant_id: string;
        updated_at: string;
        cmms_synced_at: string | null;
      }>(
        `SELECT id, tenant_id, updated_at::text, cmms_synced_at::text
         FROM cmms_equipment WHERE atlas_id = $1 LIMIT 1`,
        [atlasId],
      );
      const local = found.rows[0];

      if (!local) {
        await logConflict(c, "assets", null, atlasId, a, "orphan_atlas_id", null);
        stats.conflicts++;
        continue;
      }

      const localUpdated = new Date(local.updated_at);
      const lastSynced = local.cmms_synced_at ? new Date(local.cmms_synced_at) : new Date(0);
      if (localUpdated > lastSynced) {
        await logConflict(c, "assets", local.id, atlasId, a, "neondb_newer", local.tenant_id);
        stats.conflicts++;
        continue;
      }

      await c.query(
        `UPDATE cmms_equipment
         SET description = COALESCE($1, description),
             manufacturer = COALESCE($2, manufacturer),
             model_number = COALESCE($3, model_number),
             serial_number = COALESCE($4, serial_number),
             cmms_synced_at = NOW(),
             cmms_synced_etag = $5,
             updated_at = NOW()
         WHERE id = $6 AND tenant_id = $7`,
        [
          a.description ?? null,
          a.manufacturer ?? null,
          a.model ?? null,
          a.serialNumber ?? null,
          etagOf(a),
          local.id,
          local.tenant_id,
        ],
      );
      stats.pulled++;
    }
    if (items.length < pageSize) break;
  }

  await setCheckpoint(c, "assets", maxSeen);
  return stats;
}

export async function runReverseSync(atlas?: AtlasClient): Promise<SyncStats> {
  if (!syncEnabled()) {
    console.log("[cmms-sync] CMMS_SYNC_ENABLED=false — reverse sync is a no-op.");
    return { ...ZERO_STATS };
  }
  const client = atlas ?? new AtlasClient();
  if (!client.configured) {
    console.warn("[cmms-sync] Atlas client unconfigured — skipping reverse sync.");
    return { ...ZERO_STATS };
  }

  return withWorkerClient(async (c) => {
    const totals: SyncStats = { ...ZERO_STATS };
    for (const [label, fn] of [
      ["work_orders", () => pullAtlasWorkOrders(c, client)],
      ["assets", () => pullAtlasAssets(c, client)],
    ] as const) {
      try {
        const s = await fn();
        console.log(`[cmms-sync] reverse ${label}: pulled=${s.pulled} conflicts=${s.conflicts}`);
        totals.pulled += s.pulled;
        totals.conflicts += s.conflicts;
      } catch (err) {
        totals.errors++;
        console.error(`[cmms-sync] reverse ${label} failed:`, err instanceof Error ? err.message : err);
      }
    }
    return totals;
  });
}
