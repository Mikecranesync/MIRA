// The bridge and the notebook must not fight over the kg_entities natural key.
//
//   $env:TEST_DATABASE_URL="postgres://..."; $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   npx vitest run --config vitest.integration.config.ts src/lib/knowledge-graph/__tests__/asset-bridge-notebook.integration.test.ts
//
// WHY THIS EXISTS
// `createAndBindNotebookTx` creates the notebook's OWN backing node as
// entity_type='equipment' with `name` taken from the asset. `kg_entities` is
// UNIQUE (tenant_id, entity_type, name), so once asset create mints an
// identity node under that same name, the notebook's backing-node INSERT
// raises 23505 — and the handler maps EVERY 23505 in that block to
// NOTEBOOK_RACE, so a first, uncontended tap returns 409
// "Another request just opened this notebook. Try again." Retrying never
// helps: the name is still taken.
//
// Before the bridge existed the asset had no kg row, so the name was always
// free and this was latent. It is reproduced here against the real schema
// because the unit suite mocks the client and cannot see the constraint.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { mintAssetBridgeNode } from "../asset-bridge";
import { createAndBindNotebookTx } from "@/lib/equipment-notebooks";

const TENANT = "00000000-0000-0000-0000-0000000b1d70";
let client: PoolClient;

/**
 * Every real caller runs inside `withTenantContext`, which opens an explicit
 * transaction — and that is what makes the SAVEPOINT fallback both necessary
 * and legal. Running these calls in autocommit instead would let a plain retry
 * "work" and hide the production failure, which is exactly how the first
 * version of this suite passed while production returned 409.
 */
async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}


async function createAsset(tag: string, description: string) {
  const { rows } = await client.query(
    `INSERT INTO cmms_equipment (tenant_id, equipment_number, manufacturer, slug, path, description)
     VALUES ($1::uuid, $2, 'Allen-Bradley', $3, $4, $5) RETURNING id::text AS id`,
    [TENANT, tag, tag.toLowerCase(), `/${tag.toLowerCase()}`, description],
  );
  return String(rows[0].id);
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  client = await testPool.connect();
  await client.query(`ALTER TABLE cmms_equipment ADD COLUMN IF NOT EXISTS uns_path ltree`);
  await client.query(`ALTER TABLE cmms_equipment ADD COLUMN IF NOT EXISTS description text`);
  await client.query(
    `INSERT INTO tenants (id, slug, name, status) VALUES ($1::uuid, 'bridge-nb', 'Bridge nb', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
});

afterAll(async () => {
  client?.release();
  await testPool.end();
});

beforeEach(async () => {
  await client.query(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
  await client.query(`DELETE FROM kg_entities WHERE tenant_id = $1::uuid`, [TENANT]);
  await client.query(`DELETE FROM cmms_equipment WHERE tenant_id = $1::uuid`, [TENANT]);
});

describe("create the asset, then open its notebook", () => {
  it("opens on the first, uncontended tap", async () => {
    const assetId = await createAsset("CV-401", "Discharge Conveyor");
    await inTx(() => mintAssetBridgeNode(client, TENANT, {
      assetId,
      tag: "CV-401",
      description: "Discharge Conveyor",
      manufacturer: "Allen-Bradley",
    }));

    // This is the call that returned 409 notebook_race in production.
    const res = await createAndBindNotebookTx(TENANT, assetId, {
      selectedVia: "qr",
      createdBy: null,
      displayName: null,
    });

    expect(res).toMatchObject({ ok: true, created: true });
  });

  it("still binds when the machine's description collides with another machine's", async () => {
    // Two conveyors described the same way, each opening a notebook — the
    // bridge disambiguates its own row, and the notebook must not then trip
    // over either of them.
    const a = await createAsset("CV-402", "Discharge Conveyor");
    const b = await createAsset("CV-403", "Discharge Conveyor");
    await inTx(() => mintAssetBridgeNode(client, TENANT, { assetId: a, tag: "CV-402", description: "Discharge Conveyor" }));
    await inTx(() => mintAssetBridgeNode(client, TENANT, { assetId: b, tag: "CV-403", description: "Discharge Conveyor" }));

    const ra = await createAndBindNotebookTx(TENANT, a, { selectedVia: "qr", createdBy: null, displayName: null });
    const rb = await createAndBindNotebookTx(TENANT, b, { selectedVia: "qr", createdBy: null, displayName: null });

    expect(ra).toMatchObject({ ok: true, created: true });
    expect(rb).toMatchObject({ ok: true, created: true });
  });

  it("a second tap on the same machine returns the same notebook, not a duplicate", async () => {
    const assetId = await createAsset("CV-404", "Discharge Conveyor");
    await inTx(() => mintAssetBridgeNode(client, TENANT, { assetId, tag: "CV-404", description: "Discharge Conveyor" }));

    const first = await createAndBindNotebookTx(TENANT, assetId, { selectedVia: "qr", createdBy: null, displayName: null });
    const second = await createAndBindNotebookTx(TENANT, assetId, { selectedVia: "qr", createdBy: null, displayName: null });

    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    if (first.ok && second.ok) expect(second.notebook.id).toBe(first.notebook.id);

    const n = await client.query(
      `SELECT count(*)::int AS n FROM equipment_notebooks WHERE tenant_id = $1::uuid`,
      [TENANT],
    );
    expect(n.rows[0].n).toBe(1);
  });
});
