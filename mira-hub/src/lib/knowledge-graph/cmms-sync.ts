/**
 * Batch CMMS → KG import (#792).
 *
 * Pulls equipment, work orders, PM schedules, and parts from NeonDB
 * (tenant-scoped via withTenantContext) and Atlas API (admin-token,
 * parts only), then upserts KG entities + relationships + triple logs.
 *
 * Idempotent: every entity write uses ON CONFLICT DO UPDATE so re-running
 * the sync produces the same KG state without duplicates.
 */

import pool from "@/lib/db";
import type { PoolClient } from "pg";
import { equipmentPath, manufacturerPath, modelPath } from "@/lib/uns";

export interface SyncResult {
  tenantId: string;
  equipment: number;
  workOrders: number;
  pmSchedules: number;
  parts: number;
  locations: number;
  manufacturers: number;
  models: number;
  relationships: number;
  triples: number;
  durationMs: number;
}

/**
 * Resolve an equipment uns_path under the tenant's wizard hierarchy.
 *
 * Strategy:
 *   1. If the row already has a `cmms_equipment.uns_path` AND that path is in
 *      the compact wizard grammar (no `site`/`area`/`line`/`equipment` literal
 *      markers), use it verbatim.
 *   2. Otherwise compute `<parentPath>.<eq_slug>` where parentPath is the
 *      tenant's deepest wizard-style path (line if it exists, else site).
 *      ISA-95 marker paths produced by tools/cmms_equipment_uns_backfill.py
 *      are deliberately ignored here — the tree expects wizard grammar so the
 *      eq nests under the line.
 *
 * Returns null when no parent path is available (tenant hasn't run the
 * wizard) AND the row has no usable identifier — caller leaves uns_path
 * unset.
 */
const ISA95_MARKERS = ["site", "area", "line", "equipment", "work_cell"] as const;

export function resolveEquipmentUnsPath(
  rawCmmsPath: string | null,
  parentPath: string | null,
  eqIdentifier: string | null,
): string | null {
  if (rawCmmsPath && rawCmmsPath.length > 0) {
    const segments = rawCmmsPath.split(".");
    const hasIsa95Markers = segments.some((s) => (ISA95_MARKERS as readonly string[]).includes(s));
    if (!hasIsa95Markers) return rawCmmsPath;
  }
  return equipmentPath(parentPath, eqIdentifier);
}

// ── Atlas API helpers (parts only — no tenant mapping needed) ─────────────

const ATLAS_URL = (process.env.HUB_CMMS_API_URL ?? "http://atlas-api:8080").replace(/\/$/, "");
let _atlasToken = "";
let _atlasTokenExp = 0;

async function atlasAdminToken(): Promise<string | null> {
  const user = process.env.ATLAS_API_USER;
  const pass = process.env.ATLAS_API_PASSWORD;
  if (!user || !pass) return null;
  if (_atlasToken && Date.now() < _atlasTokenExp) return _atlasToken;
  try {
    const res = await fetch(`${ATLAS_URL}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user, password: pass, type: "CLIENT" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string; accessToken?: string };
    const tok = data.token ?? data.accessToken ?? null;
    if (tok) { _atlasToken = tok; _atlasTokenExp = Date.now() + 23 * 3600_000; }
    return tok;
  } catch {
    return null;
  }
}

interface AtlasPart {
  id: number | string;
  name?: string;
  partNumber?: string;
  description?: string;
  unitCost?: number;
  quantity?: number;
  location?: string;
}

async function fetchAtlasParts(): Promise<AtlasPart[]> {
  const token = await atlasAdminToken();
  if (!token) return [];
  try {
    const res = await fetch(`${ATLAS_URL}/parts/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pageSize: 200, pageNum: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { content?: AtlasPart[] };
    return data.content ?? [];
  } catch {
    return [];
  }
}

// ── Transaction helper that sets both tenant settings (RLS) ───────────────

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

// ── Entity upsert (batch, single transaction) ─────────────────────────────

interface EntityRow {
  id: string;
  entity_type: string;
  entity_id: string;
}

async function batchUpsertEntities(
  client: PoolClient,
  tenantId: string,
  entities: Array<{
    entityType: string;
    entityId: string;
    name: string;
    properties: Record<string, unknown>;
    unsPath?: string | null;
  }>,
): Promise<EntityRow[]> {
  if (entities.length === 0) return [];
  const rows: EntityRow[] = [];
  for (const e of entities) {
    // uns_path is COALESCEd: never overwrite a manually-set path with NULL.
    // When EXCLUDED.uns_path is non-null it wins (lets re-sync correct a stale path).
    const { rows: r } = await client.query<EntityRow>(
      `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path)
       VALUES ($1, $2, $3, $4, $5, $6::ltree)
       ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET
         name       = EXCLUDED.name,
         properties = kg_entities.properties || EXCLUDED.properties,
         uns_path   = COALESCE(EXCLUDED.uns_path, kg_entities.uns_path),
         updated_at = now()
       RETURNING id, entity_type, entity_id`,
      [tenantId, e.entityType, e.entityId, e.name, JSON.stringify(e.properties), e.unsPath ?? null],
    );
    if (r[0]) rows.push(r[0]);
  }
  return rows;
}

/**
 * Resolve the tenant's deepest wizard-style parent path (line preferred,
 * else site) so cmms equipment rows can nest under it. Returns null when
 * the wizard hasn't run.
 */
async function resolveTenantParentPath(
  client: PoolClient,
  tenantId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ uns_path: string | null }>(
    `SELECT uns_path::text AS uns_path
       FROM kg_entities
      WHERE tenant_id = $1::uuid
        AND entity_type IN ('site', 'plant', 'line', 'production_line')
        AND uns_path IS NOT NULL
      ORDER BY nlevel(uns_path) DESC, updated_at DESC
      LIMIT 1`,
    [tenantId],
  );
  return rows[0]?.uns_path ?? null;
}

/**
 * Mirror tenant-scoped (manufacturer, model_number) pairs from
 * knowledge_entries into kg_entities so the namespace tree shows the
 * tenant's manual catalog under `enterprise.knowledge_base.<mfr>[.<model>]`.
 *
 * `/api/knowledge/manufacturer/route.ts` is the universal admin view that
 * deliberately ignores tenant_id; this mirror is the opposite — only what
 * THIS tenant has indexed. tools/uns_backfill.py also does this from the
 * Python side; the upserts are idempotent so the overlap is intentional.
 */
async function mirrorKnowledgeEntities(
  client: PoolClient,
  tenantId: string,
): Promise<{ manufacturers: number; models: number }> {
  const { rows } = await client.query<{ manufacturer: string; model: string | null }>(
    `SELECT
        TRIM(manufacturer) AS manufacturer,
        NULLIF(TRIM(COALESCE(model_number, '')), '') AS model
       FROM knowledge_entries
      WHERE tenant_id = $1::uuid
        AND manufacturer IS NOT NULL
        AND TRIM(manufacturer) <> ''
      GROUP BY TRIM(manufacturer), NULLIF(TRIM(COALESCE(model_number, '')), '')`,
    [tenantId],
  );
  if (rows.length === 0) return { manufacturers: 0, models: 0 };

  const mfrSet = new Map<string, { entityType: string; entityId: string; name: string; properties: Record<string, unknown>; unsPath: string }>();
  const modelEntries: Array<{ entityType: string; entityId: string; name: string; properties: Record<string, unknown>; unsPath: string }> = [];

  for (const r of rows) {
    const mfr = r.manufacturer;
    const mfrPath = manufacturerPath(mfr);
    if (!mfrSet.has(mfrPath)) {
      mfrSet.set(mfrPath, {
        entityType: "manufacturer",
        entityId: mfrPath,
        name: mfr,
        properties: { source: "knowledge_entries_mirror" },
        unsPath: mfrPath,
      });
    }
    if (r.model) {
      const mPath = modelPath(mfr, r.model);
      modelEntries.push({
        entityType: "model",
        entityId: mPath,
        name: r.model,
        properties: { manufacturer: mfr, source: "knowledge_entries_mirror" },
        unsPath: mPath,
      });
    }
  }

  await batchUpsertEntities(client, tenantId, Array.from(mfrSet.values()));
  await batchUpsertEntities(client, tenantId, modelEntries);
  return { manufacturers: mfrSet.size, models: modelEntries.length };
}

async function upsertRelationship(
  client: PoolClient,
  tenantId: string,
  sourceId: string,
  targetId: string,
  relType: string,
  convId?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO kg_relationships
       (tenant_id, source_id, target_id, relationship_type, confidence, source_conversation_id)
     VALUES ($1, $2, $3, $4, 1.0, $5)
     ON CONFLICT DO NOTHING`,
    [tenantId, sourceId, targetId, relType, convId ?? null],
  );
}

async function logTriple(
  client: PoolClient,
  tenantId: string,
  subject: string,
  predicate: string,
  object: string,
): Promise<void> {
  await client.query(
    `INSERT INTO kg_triples_log
       (tenant_id, subject, predicate, object, confidence, source)
     VALUES ($1, $2, $3, $4, 1.0, 'cmms_sync')`,
    [tenantId, subject, predicate, object],
  );
}

// ── Main sync ─────────────────────────────────────────────────────────────

export async function syncCmmsToKg(tenantId: string): Promise<SyncResult> {
  const t0 = Date.now();

  // ── 1. Pull CMMS data from NeonDB ──────────────────────────────────────
  const [equipmentRows, workOrderRows, pmRows, parentPath] = await withKgContext(tenantId, async (client) => {
    const parent = await resolveTenantParentPath(client, tenantId);
    const [eq, wo, pm] = await Promise.all([
      client.query(
        `SELECT id, equipment_number, manufacturer, model_number, serial_number,
                equipment_type, location, department, criticality, description,
                uns_path::text AS uns_path
         FROM cmms_equipment WHERE tenant_id = $1 LIMIT 500`,
        [tenantId],
      ).then((r) => r.rows as Record<string, unknown>[]),
      client.query(
        `SELECT id, work_order_number, equipment_id, manufacturer, model_number,
                title, description, status, priority, source, created_at
         FROM work_orders WHERE tenant_id = $1 LIMIT 1000`,
        [tenantId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })).then((r) => Array.isArray(r) ? r : r.rows),
      client.query(
        `SELECT id, equipment_id, manufacturer, model_number, task,
                interval_value, interval_unit, criticality, next_due_at, parts_needed
         FROM pm_schedules WHERE tenant_id = $1 LIMIT 500`,
        [tenantId],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })).then((r) => Array.isArray(r) ? r : r.rows),
    ]);
    return [eq, wo, pm, parent] as const;
  });

  // ── 2. Fetch parts from Atlas (best-effort) ────────────────────────────
  const atlasParts = await fetchAtlasParts();

  // ── 3. Build entity lists ──────────────────────────────────────────────
  const equipmentEntities = equipmentRows.map((r) => {
    const eqIdent = String(r.equipment_number ?? r.id ?? "").trim() || null;
    const rawCmmsPath = typeof r.uns_path === "string" && r.uns_path.length > 0 ? r.uns_path : null;
    return {
      entityType: "equipment",
      entityId: String(r.id),
      name: String(r.description || [r.manufacturer, r.model_number].filter(Boolean).join(" ") || r.id),
      properties: {
        equipment_number: r.equipment_number ?? null,
        manufacturer: r.manufacturer ?? null,
        model_number: r.model_number ?? null,
        serial_number: r.serial_number ?? null,
        equipment_type: r.equipment_type ?? null,
        location: r.location ?? null,
        department: r.department ?? null,
        criticality: r.criticality ?? null,
      },
      unsPath: resolveEquipmentUnsPath(rawCmmsPath, parentPath, eqIdent),
    };
  });

  const woEntities = workOrderRows.map((r) => ({
    entityType: "work_order",
    entityId: String(r.id),
    name: String(r.title || r.work_order_number || r.id),
    properties: {
      work_order_number: r.work_order_number ?? null,
      equipment_id: r.equipment_id ?? null,
      status: r.status ?? null,
      priority: r.priority ?? null,
      source: r.source ?? null,
    },
  }));

  const pmEntities = pmRows.map((r) => ({
    entityType: "pm_schedule",
    entityId: String(r.id),
    name: String(r.task || `PM-${r.id}`),
    properties: {
      equipment_id: r.equipment_id ?? null,
      manufacturer: r.manufacturer ?? null,
      model_number: r.model_number ?? null,
      interval: `${r.interval_value} ${r.interval_unit}`,
      criticality: r.criticality ?? null,
      next_due_at: r.next_due_at ?? null,
    },
  }));

  // Unique location entities derived from equipment location field
  const locationNames = [
    ...new Set(equipmentRows.map((r) => String(r.location ?? "")).filter(Boolean)),
  ];
  const locationEntities = locationNames.map((loc) => ({
    entityType: "location",
    entityId: loc.toLowerCase().replace(/\s+/g, "-"),
    name: loc,
    properties: {},
  }));

  const partEntities = atlasParts.map((p) => ({
    entityType: "part",
    entityId: String(p.id),
    name: p.name ?? p.description ?? p.partNumber ?? String(p.id),
    properties: {
      part_number: p.partNumber ?? null,
      unit_cost: p.unitCost ?? null,
      quantity: p.quantity ?? null,
      location: p.location ?? null,
    },
  }));

  // ── 4. Upsert all entities + build relationships + log triples ──────────
  let relCount = 0;
  let tripleCount = 0;

  await withKgContext(tenantId, async (client) => {
    // Upsert entity groups
    const [eqRows, woRows, pmInserted, locRows] = await Promise.all([
      batchUpsertEntities(client, tenantId, equipmentEntities),
      batchUpsertEntities(client, tenantId, woEntities),
      batchUpsertEntities(client, tenantId, pmEntities),
      batchUpsertEntities(client, tenantId, locationEntities),
    ]);
    await batchUpsertEntities(client, tenantId, partEntities);

    // Build lookup maps: entityId → KG uuid
    const eqById = new Map(eqRows.map((r) => [r.entity_id, r.id]));
    const woById = new Map(woRows.map((r) => [r.entity_id, r.id]));
    const pmById = new Map(pmInserted.map((r) => [r.entity_id, r.id]));
    const locByName = new Map(locRows.map((r) => [r.entity_id, r.id]));

    // equipment → located_at → location
    for (const r of equipmentRows) {
      const locRaw = String(r.location ?? "");
      if (!locRaw) continue;
      const locSlug = locRaw.toLowerCase().replace(/\s+/g, "-");
      const eqKgId = eqById.get(String(r.id));
      const locKgId = locByName.get(locSlug);
      if (eqKgId && locKgId) {
        await upsertRelationship(client, tenantId, eqKgId, locKgId, "located_at");
        await logTriple(client, tenantId, String(r.description || r.id), "located_at", locRaw);
        relCount++; tripleCount++;
      }
    }

    // equipment → has_work_order → work_order
    for (const r of workOrderRows) {
      const eqId = String(r.equipment_id ?? "");
      if (!eqId) continue;
      const eqKgId = eqById.get(eqId);
      const woKgId = woById.get(String(r.id));
      if (eqKgId && woKgId) {
        await upsertRelationship(client, tenantId, eqKgId, woKgId, "has_work_order");
        await logTriple(client, tenantId, String(r.equipment_id), "has_work_order", String(r.title || r.id));
        relCount++; tripleCount++;
      }
    }

    // equipment → has_pm → pm_schedule
    for (const r of pmRows) {
      const eqId = String(r.equipment_id ?? "");
      if (!eqId) continue;
      const eqKgId = eqById.get(eqId);
      const pmKgId = pmById.get(String(r.id));
      if (eqKgId && pmKgId) {
        await upsertRelationship(client, tenantId, eqKgId, pmKgId, "has_pm");
        await logTriple(client, tenantId, String(r.equipment_id), "has_pm", String(r.task || r.id));
        relCount++; tripleCount++;
      }
    }

    // Log is_a triples for all entities
    for (const e of equipmentEntities) {
      await logTriple(client, tenantId, e.name, "is_a", "equipment");
      tripleCount++;
    }
    for (const e of woEntities) {
      await logTriple(client, tenantId, e.name, "is_a", "work_order");
      tripleCount++;
    }
    for (const e of pmEntities) {
      await logTriple(client, tenantId, e.name, "is_a", "pm_schedule");
      tripleCount++;
    }
    for (const e of partEntities) {
      await logTriple(client, tenantId, e.name, "is_a", "part");
      tripleCount++;
    }
  });

  // ── 5. Mirror tenant's knowledge_entries manufacturers + models ────────
  // Runs in its own transaction so a knowledge_entries read error doesn't
  // unwind the cmms upserts.
  let mirrorCounts = { manufacturers: 0, models: 0 };
  try {
    mirrorCounts = await withKgContext(tenantId, (client) => mirrorKnowledgeEntities(client, tenantId));
  } catch (err) {
    console.error("[cmms-sync] knowledge_entries mirror failed:", err);
  }

  return {
    tenantId,
    equipment: equipmentEntities.length,
    workOrders: woEntities.length,
    pmSchedules: pmEntities.length,
    parts: partEntities.length,
    locations: locationEntities.length,
    manufacturers: mirrorCounts.manufacturers,
    models: mirrorCounts.models,
    relationships: relCount,
    triples: tripleCount,
    durationMs: Date.now() - t0,
  };
}
