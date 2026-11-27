// #6085: migration 118 and the confirmed-number write, against a real, disposable Postgres.
// The number is decided inside the identity confirm's own locked transaction
// (`confirmNotebookIdentity`, #6104 r2 F3/F4): only the confirm that settles the identity may add
// one, one number per machine, a retry of it stays a success, another tenant can neither read nor
// write, and a failing number write rolls back alone.
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
import type { Pool, PoolClient } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { numbersForIdentity, readConfirmedNumbers } from "@/capabilities/confirmed-numbers";
import { confirmNotebookIdentity, threadStatusScope } from "@/capabilities/notebook-manual-acquisition";

const TENANT = "6085beef-0000-4000-8000-000000000001";
const OTHER = "6085beef-0000-4000-8000-000000000009";
const NODE_ID = "6085beef-0000-4000-8000-000000000002";
const ID = { manufacturer: "Siemens", model: "TP700", catalogNumber: "" };
const NUMBER = { number: "6AV2124-0GC01-0AX0", code: "6AV21240GC010AX0" };
const OTHER_NUMBER = { number: "6AV2124-0JC01-0AX0", code: "6AV21240JC010AX0" };
const ENTRY = { ...NUMBER, manufacturer: "Siemens", model: "TP700" };
const J2 = "Our Siemens TP700 Comfort panel 6AV2124-0GC01-0AX0 will not power up. What is the rated supply voltage?";
/** The same question naming a different order number for the same model (the wrong-number control). */
const J2_WRONG = "Our Siemens TP700 Comfort panel 6AV2124-0JC01-0AX0 will not power up. What is the rated supply voltage?";

/** A notebook with no identity yet (the only kind that gets identity cards), optionally carrying
 *  entries left from an earlier identity. */
async function makeBlank(entries: unknown[] = []): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name, confirmed_numbers)
     VALUES ($1::uuid, $2::uuid, 'number bench', $3::jsonb) RETURNING id::text AS id`,
    [TENANT, NODE_ID, JSON.stringify(entries)],
  );
  return res.rows[0]!.id;
}
const status = async (nb: string) =>
  (await testPool.query<{ identity_status: string | null }>(`SELECT identity_status FROM equipment_notebooks WHERE id = $1::uuid`, [nb])).rows[0]!.identity_status;
const scopeOf = async (nb: string, question = J2) =>
  threadStatusScope([question], { ...ENTRY, catalogNumber: "", recordCatalog: null, confirmedNumbers: numbersForIdentity(await readConfirmedNumbers(TENANT, nb), ENTRY) });
const wipe = () => testPool.query(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER]);

/** Runs `racing` while `first` holds an uncommitted write on the row: asserts the racing confirm
 *  is blocked on the row lock (precondition), then commits `first` and returns the racing result. */
async function raceBehind<T>(first: PoolClient, racing: () => Promise<T>): Promise<T> {
  const pending = racing();
  let waiting = 0;
  for (let i = 0; i < 100 && !waiting; i++) {
    await new Promise((r) => setTimeout(r, 20));
    const res = await testPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    waiting = Number(res.rows[0]!.n);
  }
  expect(waiting).toBe(1); // precondition: the racing confirm waits for the row
  await first.query("COMMIT");
  return pending;
}
const SETTLE_SQL = `UPDATE equipment_notebooks SET manufacturer = 'Siemens', model = 'TP700', catalog_number = '', identity_status = 'user_confirmed', identity_source_type = 'user' WHERE id = $1::uuid`;

beforeAll(wipe);
afterAll(async () => { await wipe(); await testPool.end(); });

describe("migration 118 + the number decided in the identity confirm (real Postgres)", () => {
  it("re-applying the migration is a no-op", async () => {
    const sql = readFileSync(join(__dirname, "../../../db/migrations/118_notebook_confirmed_numbers.sql"), "utf8");
    await expect(testPool.query(sql)).resolves.toBeDefined();
    const col = await testPool.query(
      `SELECT data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'equipment_notebooks' AND column_name = 'confirmed_numbers'`,
    );
    expect(col.rows[0]).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
  });

  it("the confirm that settles the identity saves the ticked number; a retry of it stays a success and does not duplicate", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await confirmNotebookIdentity(TENANT, nb, ID, { ...NUMBER, number: "6av2124-0gc01-0ax0" })).toEqual({ ok: true, numberSaved: true });
    const saved = await readConfirmedNumbers(TENANT, nb);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject(ENTRY);
    expect(await scopeOf(nb)).toBe("own");
  });

  // One ticked number authorizes exactly that number: the thread naming it settles, a thread
  // naming another order number for the same model stays withheld, as it does with nothing ticked.
  it("the ticked number authorizes exactly that number, not another for the same model", async () => {
    const nb = await makeBlank();
    expect(await scopeOf(nb, J2_WRONG)).toBe("other"); // control: nothing ticked yet
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb, J2)).toBe("own");
    expect(await scopeOf(nb, J2_WRONG)).toBe("other");
  });

  // A refresh reads the committed row again, on a new connection: the confirm, the number and the
  // settled thread are all there; an unticked confirm leaves the thread withheld after a refresh.
  it("the confirmation and its number survive a refresh; unticked, the thread stays withheld", async () => {
    const ticked = await makeBlank();
    const unticked = await makeBlank();
    await confirmNotebookIdentity(TENANT, ticked, ID, NUMBER);
    await confirmNotebookIdentity(TENANT, unticked, ID);
    const fresh = await testPool.connect();
    try {
      const rows = await fresh.query<{ id: string; identity_status: string; manufacturer: string; model: string; catalog_number: string }>(
        `SELECT id::text AS id, identity_status, manufacturer, model, catalog_number FROM equipment_notebooks WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[ticked, unticked]],
      );
      for (const r of rows.rows) expect(r).toMatchObject({ identity_status: "user_confirmed", manufacturer: "Siemens", model: "TP700", catalog_number: "" });
    } finally {
      fresh.release();
    }
    expect((await readConfirmedNumbers(TENANT, ticked)).map((e) => e.code)).toEqual(["6AV21240GC010AX0"]);
    expect(await scopeOf(ticked)).toBe("own");
    expect(await readConfirmedNumbers(TENANT, unticked)).toEqual([]);
    expect(await scopeOf(unticked)).toBe("other");
  });

  it("another tenant can neither read nor write it", async () => {
    const nb = await makeBlank();
    expect((await confirmNotebookIdentity(OTHER, nb, ID, NUMBER)).ok).toBe(false);
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    await confirmNotebookIdentity(TENANT, nb, ID, NUMBER);
    expect(await readConfirmedNumbers(OTHER, nb)).toEqual([]);
  });

  // #6104 r2 F3: a stale second card for the same machine (another tab) cannot add a number once
  // the identity is settled, whichever box the first confirm left.
  it("after an unticked first confirm, a later ticked card adds nothing", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID)).toEqual({ ok: true });
    expect(await status(nb)).toBe("user_confirmed"); // precondition: the identity is settled
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    expect(await scopeOf(nb)).toBe("other");
  });

  it("an unticked confirm leaves the numbers untouched", async () => {
    const nb = await makeBlank();
    await confirmNotebookIdentity(TENANT, nb, ID);
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  // #6104 r1 F3: one number per machine. A stale second card naming another number for the same
  // machine is refused and leaves the first; a retry of the first stays a success.
  it("a second, different number for the same machine is refused and the first stays", async () => {
    const nb = await makeBlank();
    expect((await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).ok).toBe(true);
    expect(await confirmNotebookIdentity(TENANT, nb, ID, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect((await readConfirmedNumbers(TENANT, nb)).map((e) => e.number)).toEqual(["6AV2124-0GC01-0AX0"]);
  });

  // #6104 r2 F3, the race: the unticked confirm that settles the identity is still in flight when
  // the ticked card arrives. The ticked confirm waits for the row, then sees a settled identity.
  it("a ticked confirm racing an unticked one in flight waits for it and adds nothing", async () => {
    const nb = await makeBlank();
    const first = await testPool.connect();
    let result: Awaited<ReturnType<typeof confirmNotebookIdentity>>;
    try {
      await first.query("BEGIN");
      await first.query(SETTLE_SQL, [nb]);
      result = await raceBehind(first, () => confirmNotebookIdentity(TENANT, nb, ID, NUMBER));
    } finally {
      first.release();
    }
    expect(result).toEqual({ ok: true, numberSaved: false });
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  // The other order: the winning ticked confirm is in flight with its number; a racing card with a
  // different number waits, then is refused. Only the winner's choice takes effect.
  it("a confirm racing a winning ticked confirm in flight waits for it and is refused", async () => {
    const nb = await makeBlank();
    const first = await testPool.connect();
    let result: Awaited<ReturnType<typeof confirmNotebookIdentity>>;
    try {
      await first.query("BEGIN");
      await first.query(SETTLE_SQL, [nb]);
      await first.query(
        `UPDATE equipment_notebooks SET confirmed_numbers = confirmed_numbers || $2::jsonb WHERE id = $1::uuid`,
        [nb, JSON.stringify([{ ...ENTRY, confirmedAt: "2026-11-27T00:00:00.000Z" }])],
      );
      result = await raceBehind(first, () => confirmNotebookIdentity(TENANT, nb, ID, OTHER_NUMBER));
    } finally {
      first.release();
    }
    expect(result).toEqual({ ok: true, numberSaved: false });
    expect((await readConfirmedNumbers(TENANT, nb)).map((e) => e.code)).toEqual(["6AV21240GC010AX0"]);
  });

  // #6104 r2 F4: the tick is decided with the catalog number this same confirm writes. A machine
  // with a catalog number never reads ticked numbers, so the tick is refused, not saved unread.
  it("a confirm that writes a catalog number refuses the tick", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, { ...ID, catalogNumber: "6AV2124-0GC01-0AX0" }, NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  // #6104 r2 F4, the race: a Settings catalog edit in flight is serialised behind the row lock, so
  // the response always describes the state the confirm committed (this confirm writes catalog "").
  it("a catalog edit in flight is serialised: the response matches what the scope reads", async () => {
    const nb = await makeBlank();
    const first = await testPool.connect();
    let result: Awaited<ReturnType<typeof confirmNotebookIdentity>>;
    try {
      await first.query("BEGIN");
      await first.query(`UPDATE equipment_notebooks SET catalog_number = '6AV2124-0JC01-0AX0' WHERE id = $1::uuid`, [nb]);
      result = await raceBehind(first, () => confirmNotebookIdentity(TENANT, nb, ID, NUMBER));
    } finally {
      first.release();
    }
    const row = (await testPool.query<{ catalog_number: string }>(`SELECT catalog_number FROM equipment_notebooks WHERE id = $1::uuid`, [nb])).rows[0]!;
    expect(result).toEqual({ ok: true, numberSaved: true });
    expect(row.catalog_number).toBe("");
    expect(await scopeOf(nb)).toBe("own");
  });

  // A failing number write never fails the confirm: it rolls back to its own savepoint, so the
  // identity still commits (the same holds for a Hub deployed before migration 118).
  it("a failing number write rolls back alone: the identity is confirmed and numberSaved is false", async () => {
    const nb = await makeBlank();
    const unstorable = { number: "6AV2124-0GC01-0AX0\u0000", code: "6AV21240GC010AX0" }; // jsonb rejects \u0000
    expect(await confirmNotebookIdentity(TENANT, nb, ID, unstorable)).toEqual({ ok: true, numberSaved: false });
    expect(await status(nb)).toBe("user_confirmed");
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  it("the same machine spelled another way is the same machine", async () => {
    const nb = await makeBlank([{ ...ENTRY, confirmedAt: "2026-11-27T00:00:00.000Z" }]);
    expect(await confirmNotebookIdentity(TENANT, nb, { manufacturer: "SIEMENS", model: "TP 700", catalogNumber: "" }, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(await readConfirmedNumbers(TENANT, nb)).toHaveLength(1);
  });

  it("control: another machine on the same notebook gets its own number", async () => {
    const nb = await makeBlank([{ ...ENTRY, confirmedAt: "2026-11-27T00:00:00.000Z" }]);
    expect(await confirmNotebookIdentity(TENANT, nb, { ...ID, model: "TP900" }, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await readConfirmedNumbers(TENANT, nb)).toHaveLength(2);
  });

  // #6104 r1 F4: an entry the scope cannot use (no order number in it) neither blocks a usable
  // number nor stands in for one, so numberSaved true always means the thread can settle.
  it("a saved entry with no usable order number does not block or satisfy a usable one", async () => {
    const nb = await makeBlank([{ number: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700", confirmedAt: "2026-11-27T00:00:00.000Z" }]);
    expect(threadStatusScope([J2], { ...ENTRY, catalogNumber: "", recordCatalog: null, confirmedNumbers: numbersForIdentity(await readConfirmedNumbers(TENANT, nb), ENTRY) })).toBe("other"); // precondition
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb)).toBe("own");
  });
});
