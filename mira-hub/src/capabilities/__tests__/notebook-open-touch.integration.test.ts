/**
 * #4130 — getNotebook's single-statement read+touch against REAL Postgres
 * (schema from scripts/setup-integration-db.mjs, RLS under factorylm_app via
 * withTenantContext). Proves the writable CTE keeps the old SELECT-then-UPDATE
 * semantics:
 *   - the notebook is returned as it was BEFORE the touch
 *   - last_opened_at is set by the call
 *   - a foreign tenant gets null and touches nothing
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… npm run db:integration:setup && npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/notebook-open-touch
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "aaaaaaaa-4130-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-4130-4000-8000-00000000000b";

const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));

import { getNotebook } from "@/lib/equipment-notebooks";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let nb = "";

async function lastOpened(id: string): Promise<string | null> {
  const r = await pool.query(`SELECT last_opened_at::text AS t FROM equipment_notebooks WHERE id = $1::uuid`, [id]);
  return r.rows[0]?.t ?? null;
}

run("getNotebook read+touch in one statement (integration)", () => {
  beforeAll(async () => {
    const r = await pool.query(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Touch test', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT_A],
    );
    nb = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT_A, TENANT_B]);
    await pool.end();
  });

  it("returns the pre-touch row, then the touch is visible", async () => {
    expect(await lastOpened(nb)).toBeNull(); // precondition
    const first = await getNotebook(TENANT_A, nb);
    expect(first?.id).toBe(nb);
    expect(first?.lastOpenedAt).toBeNull(); // snapshot before the touch
    const touched = await lastOpened(nb);
    expect(touched).not.toBeNull();
    const second = await getNotebook(TENANT_A, nb);
    expect(second?.lastOpenedAt).not.toBeNull(); // sees the first call's touch
  });

  it("a foreign tenant gets null and does not touch the row", async () => {
    await pool.query(`UPDATE equipment_notebooks SET last_opened_at = NULL WHERE id = $1::uuid`, [nb]);
    expect(await getNotebook(TENANT_B, nb)).toBeNull();
    expect(await lastOpened(nb)).toBeNull();
  });
});
