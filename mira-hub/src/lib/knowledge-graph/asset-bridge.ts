/**
 * Asset → KG bridge row: make a created asset a WHOLE machine.
 *
 * WHY THIS EXISTS
 * A machine lives in two tables. `cmms_equipment` is the asset register a
 * technician sees, and the row `/api/assets/by-tag/{tag}` resolves a scanned
 * sticker against. `kg_entities` is the graph node every grounded surface
 * reads — `/api/assets/{id}/notebook` refuses any asset with no
 * `entity_type='equipment'` node that is `approval_state='verified'` AND
 * carries a non-null `uns_path`.
 *
 * Until this module, neither create door wrote both:
 *
 *   POST /api/namespace/node  → kg_entities only     → notebook ok, scan 404s
 *   POST /api/assets          → cmms_equipment only  → scan ok, notebook 404s
 *
 * CV-101 answered on a phone only because `tools/seeds/garage-cv101-kg-bridge.sql`
 * built its bridge row by hand. Every other asset failed the second call with
 * "That asset isn't in this account" — for an asset that IS in the account. An
 * acceptance test that only ever exercised CV-101 could not see it.
 *
 * WHY approval_state IS PINNED 'verified'
 * Pinned explicitly, exactly as `POST /api/namespace/node` pins it, for the
 * same two reasons:
 *
 *  1. The column default is contradictory across the two migration lineages —
 *     'proposed' at `mira-hub/db/migrations/029_kg_approval_state.sql`,
 *     'verified' at `docs/migrations/008_kg_approval_state.sql`. Relying on the
 *     default makes a machine chattable or not depending on which set won on
 *     the box you deployed to. Pinning removes the question.
 *
 *  2. It is NOT an auto-promotion. The prohibition in `.claude/CLAUDE.md`
 *     ("Do not auto-promote proposed → verified") is about MIRA *inferring* a
 *     fact and marking it reviewed without a human; the mechanically enforced
 *     Iron Rule (`scripts/kg_write_guard.py`, ADR-0017) governs
 *     `kg_relationships`. Here a human typed a machine they own into their own
 *     asset register — that act IS the approval — and no relationship is
 *     asserted. The same reasoning already licenses the pinned 'verified' in
 *     `namespace/node`, `createNotebook`, and `createAndBindNotebookTx`.
 *
 * WHAT THE SHAPE HAS TO BE (copied from the proven CV-101 seed)
 *   entity_type = 'equipment'
 *   entity_id   = cmms_equipment.id AS TEXT   ← the key the notebook route,
 *                 machine-memory, context and signal-history all match on
 *   properties  → carries 'asset_tag', the alias key that IS read
 *                 (mira-bots/shared/demo_namespace.py); 'equipment_number' is
 *                 kept alongside it because the seed wrote it, but no reader
 *                 uses that one.
 *   uns_path    → non-null, or the notebook route still refuses (see below)
 * and `cmms_equipment.uns_path` is backfilled to match, because
 * `.claude/rules/uns-compliance.md` requires every asset row to carry one.
 */

import type { PoolClient } from "pg";
import { equipmentPath, sitePath, slugify } from "@/lib/uns";
import { insertWithUniqueFallback } from "@/lib/pg-unique-retry";
import { resolveTenantParentPath } from "./cmms-sync";

/**
 * Name of the site minted for a tenant that has never run the namespace
 * wizard. Deliberately generic and renameable in the namespace builder — it
 * is a placeholder for a real hierarchy, not a claim about the plant.
 */
export const DEFAULT_SITE_NAME = "Main Site";

export type AssetBridgeInput = {
  /** cmms_equipment.id — becomes kg_entities.entity_id (as text). */
  assetId: string;
  /**
   * cmms_equipment.equipment_number — the scannable tag. Required: it is the
   * only per-tenant-unique handle available to disambiguate the natural key.
   */
  tag: string;
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
};

export type AssetBridgeResult =
  | { ok: true; created: boolean; nodeId: string; unsPath: string }
  | { ok: false; reason: "no_uns_path" };

/**
 * Resolve the UNS path a newly created asset should live at, creating the
 * tenant's root site if it has none.
 *
 * ── THE DECISION THIS FUNCTION ENCODES ────────────────────────────────────
 * `equipmentPath(parent, ident)` returns null without a parent path, and
 * `POST /api/auth/register` seeds no site node — so a brand-new tenant (the
 * beta gate's "stranger") has NO hierarchy, and a bridge row minted for them
 * would carry a null uns_path and the notebook would still refuse it. Three
 * ways out; this function implements the first:
 *
 *   A. Auto-create a minimal root (IMPLEMENTED). Mint one `site` node at
 *      `enterprise.main_site` on the first asset and nest the machine under
 *      it. Every machine gets a genuine, renameable path; no gate is weakened;
 *      zero onboarding friction.
 *   B. Relax the notebook route's non-null uns_path check. Fastest, but a
 *      path-less machine silently breaks any later `uns_path <@` live-evidence
 *      probe and weakens `.claude/rules/uns-compliance.md`.
 *   C. Require the wizard before an asset can be created. Doctrinally cleanest
 *      and closest to train-before-deploy, but it puts a multi-step wizard in
 *      front of a technician who just wants to scan a sticker and ask.
 *
 * Switching to B or C is a change to THIS function and its caller's handling
 * of `no_uns_path` — nothing else in the bridge depends on which one is live.
 */
export async function resolveOrCreateAssetUnsPath(
  client: PoolClient,
  tenantId: string,
  tag: string,
): Promise<string | null> {
  const existing = await resolveTenantParentPath(client, tenantId);
  const parent = existing ?? (await createDefaultSite(client, tenantId));
  if (!parent) return null;
  return equipmentPath(parent, tag);
}

/**
 * Mint the tenant's root site. Idempotent via the kg_entities natural key
 * (tenant_id, entity_type, name) — the same ON CONFLICT target the onboarding
 * wizard uses, so a tenant that later runs the wizard reconciles onto this row
 * rather than duplicating it.
 */
async function createDefaultSite(client: PoolClient, tenantId: string): Promise<string | null> {
  const path = sitePath(DEFAULT_SITE_NAME);
  if (!path) return null;
  await client.query(
    `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state)
     VALUES ($1::uuid, 'site', $2, $3, $4::jsonb, $5::ltree, 'verified')
     ON CONFLICT (tenant_id, entity_type, name) DO UPDATE
        SET uns_path = COALESCE(kg_entities.uns_path, EXCLUDED.uns_path),
            updated_at = now()`,
    [
      tenantId,
      slugify(DEFAULT_SITE_NAME),
      DEFAULT_SITE_NAME,
      JSON.stringify({ source: "asset_create_default_site" }),
      path,
    ],
  );
  return path;
}

/**
 * Create the bridge node for a just-created asset.
 *
 * Runs on the CALLER'S client so it joins the caller's transaction — an asset
 * create either produces a whole machine or nothing.
 *
 * NATURAL-KEY COLLISION. `kg_entities` is UNIQUE on
 * (tenant_id, entity_type, name) (migrations 025/026, promoted to a real
 * constraint by 064). Two machines can easily share a description
 * ("Discharge Conveyor"), and the notebooks' own backing nodes are ALSO
 * entity_type='equipment', so they compete for the same key. The tag is
 * per-tenant unique (migration 083), so on collision we disambiguate with it
 * rather than failing the create.
 */
export async function mintAssetBridgeNode(
  client: PoolClient,
  tenantId: string,
  input: AssetBridgeInput,
): Promise<AssetBridgeResult> {
  const unsPath = await resolveOrCreateAssetUnsPath(client, tenantId, input.tag);
  if (!unsPath) return { ok: false as const, reason: "no_uns_path" as const };

  // Already bridged (a retry, or an asset the CMMS→KG sync reached first).
  const existing = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM kg_entities
      WHERE tenant_id = $1::uuid AND entity_type = 'equipment' AND entity_id = $2
      LIMIT 1`,
    [tenantId, input.assetId],
  );
  if (existing.rows[0]) {
    return { ok: true as const, created: false, nodeId: existing.rows[0].id, unsPath };
  }

  const base = (input.description ?? "").trim();
  const properties = JSON.stringify({
    source: "asset_create",
    asset_tag: input.tag,
    equipment_number: input.tag,
    manufacturer: input.manufacturer ?? null,
    model_number: input.model ?? null,
  });

  // `name` renders as the machine's title on the scan card, so prefer the
  // human description and fall back to a tag-qualified name only when taken.
  // The fallback MUST be savepoint-fenced: this runs inside the asset-create
  // transaction, where a 23505 aborts everything and a plain retry would die
  // with "current transaction is aborted" instead.
  const preferred = base || input.tag;
  const fallback = base ? `${base} (${input.tag})` : input.tag;
  const res = await insertWithUniqueFallback<{ id: string }>(
    client,
    `INSERT INTO kg_entities
       (tenant_id, entity_type, entity_id, name, properties, uns_path, approval_state)
     VALUES ($1::uuid, 'equipment', $2, $3, $4::jsonb, $5::ltree, 'verified')
     RETURNING id::text AS id`,
    [tenantId, input.assetId, preferred, properties, unsPath],
    [tenantId, input.assetId, fallback, properties, unsPath],
  );
  return { ok: true as const, created: true, nodeId: res.rows[0].id, unsPath };
}

/**
 * Backfill `cmms_equipment.uns_path` so the asset row carries its own path
 * (`.claude/rules/uns-compliance.md`). Only fills a NULL — never overwrites a
 * path the tenant or a backfill already chose.
 */
export async function backfillAssetUnsPath(
  client: PoolClient,
  tenantId: string,
  assetId: string,
  unsPath: string,
): Promise<void> {
  await client.query(
    `UPDATE cmms_equipment
        SET uns_path = $3::ltree, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND uns_path IS NULL`,
    [tenantId, assetId, unsPath],
  );
}
