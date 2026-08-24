// Asset → KG bridge, against a REAL Postgres with the real Hub migrations.
//
//   $env:TEST_DATABASE_URL="postgres://..."
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   npm run test:integration:db
//
// WHY THIS EXISTS ALONGSIDE THE UNIT TEST
// The unit test asserts the SQL we intend to send. It cannot see the schema.
// Every expensive bug in this area has been a deployed-vs-canonical schema
// fact that no amount of reading the repo would settle — the globally-unique
// asset tag that no migration created (#3381 / migration 083), the
// `kg_entities` natural key that moved from (tenant_id, entity_type, entity_id)
// to (tenant_id, entity_type, name) in 025/026, and the approval_state default
// that is 'proposed' in one migration lineage and 'verified' in the other.
// So this test runs the real statements and then asks the REAL notebook-route
// predicate whether the machine it produced is one it would accept.
//
// FIXTURE NOTE: the integration `cmms_equipment` is a trimmed fixture
// (db/integration-fixtures/000_base_cmms_rls.sql) with no `uns_path` column,
// and its tenant_id is uuid where production's is TEXT. The column is added
// here so the backfill can be exercised; nothing else is compensated for.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { backfillAssetUnsPath, mintAssetBridgeNode } from "../asset-bridge";

const TENANT = "00000000-0000-0000-0000-0000000b1d6e";

/** The predicate `createAndBindNotebookTx` uses, verbatim in shape. */
const NOTEBOOK_LOOKUP = `
  SELECT coalesce(entity_id, id::text) AS bind_key,
         entity_type, approval_state, uns_path::text AS uns_path
    FROM kg_entities
   WHERE tenant_id = $1::uuid AND (id::text = $2 OR entity_id = $2)
   LIMIT 1`;

/** True when the notebook route would open a notebook for this asset id. */
async function notebookWouldOpen(client: PoolClient, assetId: string) {
  const { rows } = await client.query(NOTEBOOK_LOOKUP, [TENANT, assetId]);
  const row = rows[0];
  if (!row) return { ok: false, why: "asset_not_found" };
  if (row.entity_type !== "equipment") return { ok: false, why: "asset_not_equipment" };
  if (row.approval_state !== "verified" || !row.uns_path) return { ok: false, why: "asset_not_verified" };
  return { ok: true, why: null, unsPath: row.uns_path as string };
}

async function createAsset(client: PoolClient, tag: string, manufacturer = "Allen-Bradley") {
  const { rows } = await client.query(
    `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, slug, path)
     VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id::text AS id`,
    [TENANT, tag, manufacturer, tag.toLowerCase(), `/${tag.toLowerCase()}`],
  );
  return String(rows[0].id);
}

let client: PoolClient;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required — see this file's header.");
  }
  client = await testPool.connect();
  await client.query(`ALTER TABLE cmms_equipment ADD COLUMN IF NOT EXISTS uns_path ltree`);
  await client.query(
    `INSERT INTO tenants (id, slug, name, status) VALUES ($1::uuid, 'bridge-itest', 'Bridge itest', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
});

afterAll(async () => {
  client?.release();
  await testPool.end();
});

beforeEach(async () => {
  await client.query(`DELETE FROM kg_entities WHERE tenant_id = $1::uuid`, [TENANT]);
  await client.query(`DELETE FROM cmms_equipment WHERE tenant_id = $1::uuid`, [TENANT]);
});

describe("the bridge, against the real schema", () => {
  it("reproduces the bug: an unbridged asset is invisible to the notebook route", async () => {
    const assetId = await createAsset(client, "CV-301");
    expect(await notebookWouldOpen(client, assetId)).toMatchObject({ ok: false, why: "asset_not_found" });
  });

  it("makes that same asset one the notebook route accepts", async () => {
    const assetId = await createAsset(client, "CV-301");

    const res = await mintAssetBridgeNode(client, TENANT, {
      assetId,
      tag: "CV-301",
      description: "Discharge Conveyor",
      manufacturer: "Allen-Bradley",
    });
    expect(res).toMatchObject({ ok: true, created: true, unsPath: "enterprise.main_site.cv_301" });

    const verdict = await notebookWouldOpen(client, assetId);
    expect(verdict).toMatchObject({ ok: true, unsPath: "enterprise.main_site.cv_301" });
  });

  it("the 'verified' pin is load-bearing — the column default would refuse it", async () => {
    // Direct evidence for the comment in asset-bridge.ts: this migration set
    // defaults approval_state to 'proposed', which the notebook route rejects.
    const { rows } = await client.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'kg_entities' AND column_name = 'approval_state'`,
    );
    expect(String(rows[0].column_default)).toContain("proposed");

    const assetId = await createAsset(client, "CV-302");
    await client.query(
      `INSERT INTO kg_entities (tenant_id, entity_type, entity_id, name, uns_path)
       VALUES ($1::uuid, 'equipment', $2, 'Unpinned', 'enterprise.main_site.cv_302'::ltree)`,
      [TENANT, assetId],
    );
    expect(await notebookWouldOpen(client, assetId)).toMatchObject({
      ok: false,
      why: "asset_not_verified",
    });
  });

  it("nests under the tenant's real hierarchy when the wizard has run", async () => {
    await client.query(
      `INSERT INTO kg_entities (tenant_id, entity_type, name, uns_path, approval_state)
       VALUES ($1::uuid, 'line', 'Bottling 1', 'enterprise.acme.bottling_1'::ltree, 'verified')`,
      [TENANT],
    );
    const assetId = await createAsset(client, "CV-303");

    const res = await mintAssetBridgeNode(client, TENANT, { assetId, tag: "CV-303" });

    expect(res).toMatchObject({ ok: true, unsPath: "enterprise.acme.bottling_1.cv_303" });
    const sites = await client.query(
      `SELECT count(*)::int AS n FROM kg_entities WHERE tenant_id = $1::uuid AND entity_type = 'site'`,
      [TENANT],
    );
    expect(sites.rows[0].n).toBe(0); // no default site invented over a real one
  });

  it("survives the real natural-key collision on a duplicate description", async () => {
    // kg_entities is UNIQUE (tenant_id, entity_type, name) — two conveyors
    // described the same way is ordinary, and must not fail either create.
    const first = await createAsset(client, "CV-304");
    const second = await createAsset(client, "CV-305");

    const a = await mintAssetBridgeNode(client, TENANT, { assetId: first, tag: "CV-304", description: "Discharge Conveyor" });
    const b = await mintAssetBridgeNode(client, TENANT, { assetId: second, tag: "CV-305", description: "Discharge Conveyor" });

    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: true });
    expect(await notebookWouldOpen(client, first)).toMatchObject({ ok: true });
    expect(await notebookWouldOpen(client, second)).toMatchObject({ ok: true });

    const names = await client.query(
      `SELECT name FROM kg_entities WHERE tenant_id = $1::uuid AND entity_type = 'equipment' ORDER BY name`,
      [TENANT],
    );
    expect(names.rows.map((r) => r.name)).toEqual(["Discharge Conveyor", "Discharge Conveyor (CV-305)"]);
  });

  it("is idempotent — a retried create does not double-bridge", async () => {
    const assetId = await createAsset(client, "CV-306");

    await mintAssetBridgeNode(client, TENANT, { assetId, tag: "CV-306", description: "Discharge Conveyor" });
    const again = await mintAssetBridgeNode(client, TENANT, { assetId, tag: "CV-306", description: "Discharge Conveyor" });

    expect(again).toMatchObject({ ok: true, created: false });
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM kg_entities WHERE tenant_id = $1::uuid AND entity_id = $2`,
      [TENANT, assetId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("reconciles onto the default site rather than duplicating it", async () => {
    const a = await createAsset(client, "CV-307");
    const b = await createAsset(client, "CV-308");
    await mintAssetBridgeNode(client, TENANT, { assetId: a, tag: "CV-307" });
    await mintAssetBridgeNode(client, TENANT, { assetId: b, tag: "CV-308" });

    const sites = await client.query(
      `SELECT count(*)::int AS n FROM kg_entities WHERE tenant_id = $1::uuid AND entity_type = 'site'`,
      [TENANT],
    );
    expect(sites.rows[0].n).toBe(1);
  });

  it("backfills the asset row's own uns_path, and never overwrites one", async () => {
    const assetId = await createAsset(client, "CV-309");
    const res = await mintAssetBridgeNode(client, TENANT, { assetId, tag: "CV-309" });
    if (!res.ok) throw new Error("bridge failed");

    await backfillAssetUnsPath(client, TENANT, assetId, res.unsPath);
    let row = await client.query(`SELECT uns_path::text AS p FROM cmms_equipment WHERE id = $1::uuid`, [assetId]);
    expect(row.rows[0].p).toBe("enterprise.main_site.cv_309");

    await backfillAssetUnsPath(client, TENANT, assetId, "enterprise.somewhere.else");
    row = await client.query(`SELECT uns_path::text AS p FROM cmms_equipment WHERE id = $1::uuid`, [assetId]);
    expect(row.rows[0].p).toBe("enterprise.main_site.cv_309");
  });
});
