// #6085: migration 118 and the confirmed-number write, against a real, disposable Postgres:
// re-apply is a no-op, a repeated confirm does not duplicate, another tenant can neither read
// nor write, and the write never fires migration 101's revoke trigger.
//
// From mira-hub/ (throwaway database only):
//   docker run -d --name mira6085-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test -p 55685:5432 postgres:16
//   export TEST_DATABASE_URL=postgres://postgres:testpw@127.0.0.1:55685/mira_test MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   export MIRA_INTEGRATION_EXTRA_MIGRATIONS=100_notebook_manual_acquisition.sql,101_notebook_manual_acquisition_revoke_trigger.sql,102_notebook_manual_acquisition_revoke_spares_confirmed.sql,104_notebook_manual_acquisition_confirm_promotes.sql,118_notebook_confirmed_numbers.sql
//   node scripts/setup-integration-db.mjs
//   npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/confirmed-numbers.integration.test.ts
// Not wired into CI (same status as notebook-identity-confirm.integration.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { numbersForIdentity, readConfirmedNumbers, saveConfirmedNumber } from "@/capabilities/confirmed-numbers";
import { threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const TENANT = "6085beef-0000-4000-8000-000000000001";
const OTHER = "6085beef-0000-4000-8000-000000000009";
const NODE_ID = "6085beef-0000-4000-8000-000000000002";
const ENTRY = { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700" };
const OTHER_NUMBER = { ...ENTRY, number: "6AV2124-0JC01-0AX0", code: "6AV21240JC010AX0" };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";

async function makeNotebook(): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, manufacturer, model, identity_status)
     VALUES ($1::uuid, $2::uuid, 'number bench', 'Siemens', 'TP700', 'user_confirmed') RETURNING id::text AS id`,
    [TENANT, NODE_ID],
  );
  return res.rows[0]!.id;
}
const wipe = () => testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER]);

beforeAll(wipe);
afterAll(async () => { await wipe(); await testPool.end(); });

describe("migration 118 + saveConfirmedNumber (real Postgres)", () => {
  it("re-applying the migration is a no-op", async () => {
    const sql = readFileSync(join(__dirname, "../../../db/migrations/118_notebook_confirmed_numbers.sql"), "utf8");
    await expect(testPool.query(sql)).resolves.toBeDefined();
    const col = await testPool.query(
      `SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'equipment_notebooks' AND column_name = 'confirmed_numbers'`,
    );
    expect(col.rows[0]).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
  });

  it("saves once; a repeated confirm in another spelling does not duplicate", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    expect(await saveConfirmedNumber(TENANT, nb, { ...ENTRY, number: "6av2124-0gc01-0ax0" })).toBe(true);
    const saved = await readConfirmedNumbers(TENANT, nb);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ENTRY);
  });

  it("another tenant can neither read nor write it", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(OTHER, nb, ENTRY)).toBe(false);
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    await saveConfirmedNumber(TENANT, nb, ENTRY);
    expect(await readConfirmedNumbers(OTHER, nb)).toEqual([]);
  });

  it("the write leaves the identity and updated_at untouched", async () => {
    const nb = await makeNotebook();
    const before = await testPool.query(`SELECT manufacturer, model, catalog_number, identity_status, updated_at FROM equipment_notebooks WHERE id = $1::uuid`, [nb]);
    await saveConfirmedNumber(TENANT, nb, ENTRY);
    const after = await testPool.query(`SELECT manufacturer, model, catalog_number, identity_status, updated_at FROM equipment_notebooks WHERE id = $1::uuid`, [nb]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  // #6104 r1 F3: one number per machine. A stale second card naming another number for the same
  // machine is refused and leaves the first; a retry of the first stays a success.
  it("a second, different number for the same machine is refused and the first stays", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    expect(await saveConfirmedNumber(TENANT, nb, OTHER_NUMBER)).toBe(false);
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    const saved = await readConfirmedNumbers(TENANT, nb);
    expect(saved.map((e) => e.number)).toEqual(["6AV2124-0GC01-0AX0"]);
  });

  // The decision is made under the row lock: a confirm that starts while another transaction holds
  // an uncommitted number waits, then sees it and is refused. Without the lock it would read the
  // old value, decide to append, and store a second number once the first commits.
  it("a confirm racing an uncommitted number waits for it and is refused", async () => {
    const nb = await makeNotebook();
    const first = await testPool.connect();
    try {
      await first.query("BEGIN");
      await first.query(
        `UPDATE equipment_notebooks SET confirmed_numbers = confirmed_numbers || $2::jsonb WHERE id = $1::uuid`,
        [nb, JSON.stringify([{ ...ENTRY, confirmedAt: "2026-11-27T00:00:00.000Z" }])],
      );
      const racing = saveConfirmedNumber(TENANT, nb, OTHER_NUMBER);
      let waiting = 0;
      for (let i = 0; i < 100 && !waiting; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const res = await testPool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        waiting = Number(res.rows[0]!.n);
      }
      expect(waiting).toBe(1); // precondition: the racing confirm is blocked on the row
      await first.query("COMMIT");
      expect(await racing).toBe(false);
    } finally {
      first.release();
    }
    const saved = await readConfirmedNumbers(TENANT, nb);
    expect(saved.map((e) => e.code)).toEqual(["6AV21240GC010AX0"]);
  });

  it("the same machine spelled another way is the same machine", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    expect(await saveConfirmedNumber(TENANT, nb, { ...OTHER_NUMBER, manufacturer: "SIEMENS", model: "TP 700" })).toBe(false);
    expect(await readConfirmedNumbers(TENANT, nb)).toHaveLength(1);
  });

  it("control: another machine on the same notebook gets its own number", async () => {
    const nb = await makeNotebook();
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    expect(await saveConfirmedNumber(TENANT, nb, { ...OTHER_NUMBER, model: "TP900" })).toBe(true);
    expect(await readConfirmedNumbers(TENANT, nb)).toHaveLength(2);
  });

  // #6104 r1 F4: an entry the scope cannot use (no order number in it) neither blocks a usable
  // number nor stands in for one, so numberSaved true always means the thread can settle.
  it("a saved entry with no usable order number does not block or satisfy a usable one", async () => {
    const nb = await makeNotebook();
    await testPool.query(
      `UPDATE equipment_notebooks SET confirmed_numbers = $2::jsonb WHERE id = $1::uuid`,
      [nb, JSON.stringify([{ number: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700", confirmedAt: "2026-11-27T00:00:00.000Z" }])],
    );
    const before = numbersForIdentity(await readConfirmedNumbers(TENANT, nb), ENTRY);
    expect(threadStatusScope([J2], { ...ENTRY, catalogNumber: "", recordCatalog: null, confirmedNumbers: before })).toBe("other"); // precondition
    expect(await saveConfirmedNumber(TENANT, nb, ENTRY)).toBe(true);
    const after = numbersForIdentity(await readConfirmedNumbers(TENANT, nb), ENTRY);
    expect(threadStatusScope([J2], { ...ENTRY, catalogNumber: "", recordCatalog: null, confirmedNumbers: after })).toBe("own");
  });
});
