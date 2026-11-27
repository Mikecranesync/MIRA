// #6085: migration 118 and the confirmed-number write, against a real, disposable Postgres.
// The number is decided inside the identity confirm's own locked transaction
// (`confirmNotebookIdentity`, #6104 r2 F3/F4): only the confirm that settles the identity may add
// one, one number per machine, a retry of it stays a success, another tenant can neither read nor
// write, and a failing number write rolls back alone, leaving no number; only when even emptying
// the numbers fails does the confirm fail and commit nothing.
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
import { getNotebook, updateNotebook } from "@/lib/equipment-notebooks";
import { numbersForMachine } from "@/capabilities/manual-status-subject";
import { adoptNameplateIdentity } from "@/capabilities/nameplate-identity-adoption";

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
const source = async (nb: string) =>
  (await testPool.query<{ identity_source_type: string | null }>(`SELECT identity_source_type FROM equipment_notebooks WHERE id = $1::uuid`, [nb])).rows[0]!.identity_source_type;
/** The order numbers stored on the row, read as the owner (not through the scope). */
const codes = async (nb: string) =>
  ((await testPool.query<{ c: unknown }>(`SELECT confirmed_numbers AS c FROM equipment_notebooks WHERE id = $1::uuid`, [nb])).rows[0]!.c as { code?: string }[]).map((e) => e.code);
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

  // A failing number write rolls back to its own savepoint and the numbers are emptied instead, so
  // the identity still commits, with no number (a Hub deployed before migration 118 also commits:
  // below).
  it("a failing number write rolls back alone: the identity is confirmed and numberSaved is false", async () => {
    const nb = await makeBlank();
    const unstorable = { number: "6AV2124-0GC01-0AX0\u0000", code: "6AV21240GC010AX0" }; // jsonb rejects \u0000
    expect(await confirmNotebookIdentity(TENANT, nb, ID, unstorable)).toEqual({ ok: true, numberSaved: false });
    expect(await status(nb)).toBe("user_confirmed");
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  // Round-3 pre-screen 3 (reviewer gap, before the formal round): a confirm or PATCH that settles
  // the identity never commits over numbers an earlier identity left. A replacement that fails
  // empties them instead; if even that write fails, nothing commits.
  const failNumberWrites = async () => {
    await testPool.query(
      `CREATE OR REPLACE FUNCTION fail_confirmed_numbers_6104() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected confirmed_numbers failure'; END $$`,
    );
    await testPool.query(
      `CREATE TRIGGER fail_confirmed_numbers_6104 BEFORE UPDATE OF confirmed_numbers ON equipment_notebooks FOR EACH ROW EXECUTE FUNCTION fail_confirmed_numbers_6104()`,
    );
    expect((await testPool.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'fail_confirmed_numbers_6104'`)).rowCount).toBe(1); // precondition
  };
  const restoreNumberWrites = async () => {
    await testPool.query(`DROP TRIGGER IF EXISTS fail_confirmed_numbers_6104 ON equipment_notebooks`);
    await testPool.query(`DROP FUNCTION IF EXISTS fail_confirmed_numbers_6104()`);
  };
  /** The numbers the detail read counts (numbersApply included), not just the stored ones. */
  const counted = async (nb: string) => numbersForMachine(await readConfirmedNumbers(TENANT, nb), null, (await getNotebook(TENANT, nb))!);
  /** Confirmed with the number ticked, then reopened by a model PATCH away and back. */
  const reopenedWithOldNumber = async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await updateNotebook(TENANT, nb, { model: "TP700" })).toBe(true);
    expect(await status(nb)).toBe("candidate"); // precondition: reopened
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]); // precondition: the old number is still stored
    return nb;
  };

  it("a re-confirm whose ticked number cannot be stored empties the old number instead of keeping it", async () => {
    const nb = await reopenedWithOldNumber();
    const unstorable = { number: `${OTHER_NUMBER.number}\u0000`, code: OTHER_NUMBER.code }; // jsonb rejects \u0000
    expect(await confirmNotebookIdentity(TENANT, nb, ID, unstorable)).toEqual({ ok: true, numberSaved: false });
    expect([await status(nb), await source(nb)]).toEqual(["user_confirmed", "user"]); // precondition: an identity whose numbers count
    expect(await codes(nb)).toEqual([]);
    expect(await counted(nb)).toEqual([]);
    expect(await scopeOf(nb)).toBe("other");
  });

  it("a settling re-confirm whose numbers cannot be written at all fails and commits nothing, ticked or not", async () => {
    for (const tick of [null, OTHER_NUMBER]) {
      const nb = await reopenedWithOldNumber();
      await failNumberWrites();
      try {
        await expect(tick ? confirmNotebookIdentity(TENANT, nb, ID, tick) : confirmNotebookIdentity(TENANT, nb, ID)).rejects.toThrow(/injected confirmed_numbers failure/);
      } finally {
        await restoreNumberWrites();
      }
      expect(await status(nb)).toBe("candidate");
      expect(await counted(nb)).toEqual([]);
    }
  });

  it("a by-hand status PATCH whose clear cannot be written fails and commits nothing", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await status(nb)).toBe("candidate"); // precondition: reopened
    await failNumberWrites();
    try {
      await expect(updateNotebook(TENANT, nb, { model: "TP700", identityStatus: "user_confirmed", identitySourceType: "user" })).rejects.toThrow(/injected confirmed_numbers failure/);
    } finally {
      await restoreNumberWrites();
    }
    expect([await status(nb), (await getNotebook(TENANT, nb))!.model]).toEqual(["candidate", "TP900"]);
    expect(await counted(nb)).toEqual([]);
  });

  it("control: with number writes failing, a retry on an identity the card settled and a rename both still succeed", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    await failNumberWrites();
    try {
      expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
      expect(await updateNotebook(TENANT, nb, { displayName: "number bench renamed" })).toBe(true);
    } finally {
      await restoreNumberWrites();
    }
    expect(await counted(nb)).toEqual(["6AV2124-0GC01-0AX0"]);
  });

  // A Hub deployed before migration 118: every settling confirm now writes the column, ticked or
  // not. Without the column, both still confirm the identity.
  it("without the column (before migration 118), ticked and unticked settling confirms both still confirm, and a by-hand status PATCH still saves", async () => {
    const ticked = await makeBlank();
    const unticked = await makeBlank();
    await testPool.query(`ALTER TABLE equipment_notebooks DROP COLUMN confirmed_numbers`);
    try {
      expect((await testPool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'equipment_notebooks' AND column_name = 'confirmed_numbers'`)).rowCount).toBe(0); // precondition
      expect(await confirmNotebookIdentity(TENANT, ticked, ID, NUMBER)).toEqual({ ok: true, numberSaved: false });
      expect(await confirmNotebookIdentity(TENANT, unticked, ID)).toEqual({ ok: true });
      expect(await status(ticked)).toBe("user_confirmed");
      expect(await status(unticked)).toBe("user_confirmed");
      expect(await readConfirmedNumbers(TENANT, ticked)).toEqual([]);
      expect(await updateNotebook(TENANT, unticked, { identityStatus: "candidate" })).toBe(true);
      expect(await status(unticked)).toBe("candidate");
    } finally {
      await testPool.query(`ALTER TABLE equipment_notebooks ADD COLUMN IF NOT EXISTS confirmed_numbers JSONB NOT NULL DEFAULT '[]'::jsonb`);
    }
  });

  // On a settled identity, the same machine spelled another way is the same machine: a retry of
  // its number is a success, another number is refused, and the saved one stays.
  it("the same machine spelled another way is the same machine", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    const spelled = { manufacturer: "SIEMENS", model: "TP 700", catalogNumber: "" };
    expect(await confirmNotebookIdentity(TENANT, nb, spelled, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await confirmNotebookIdentity(TENANT, nb, spelled, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect((await readConfirmedNumbers(TENANT, nb)).map((e) => e.code)).toEqual(["6AV21240GC010AX0"]);
  });

  // A confirm that settles the identity decides its numbers afresh: a settle for another machine
  // leaves only that machine's number, never the earlier machine's.
  it("a settle for another machine replaces the earlier machine's number", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await confirmNotebookIdentity(TENANT, nb, { ...ID, model: "TP900" }, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect((await readConfirmedNumbers(TENANT, nb)).map((e) => [e.model, e.code])).toEqual([["TP900", "6AV21240JC010AX0"]]);
  });

  // Controls: what an already-settled identity sees changes no number.
  it("control: after a ticked settle, a stale unticked card for the same machine, however spelled, clears nothing", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await confirmNotebookIdentity(TENANT, nb, { manufacturer: "SIEMENS", model: "TP 700", catalogNumber: "" })).toEqual({ ok: true });
    expect(await confirmNotebookIdentity(TENANT, nb, ID)).toEqual({ ok: true });
    expect(await scopeOf(nb, J2)).toBe("own");
  });

  it("control: a Settings save of the same maker and model keeps the number", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { manufacturer: "Siemens", model: "TP700" })).toBe(true);
    expect(await status(nb)).toBe("user_confirmed");
    expect(await scopeOf(nb, J2)).toBe("own");
  });

  // The nameplate photo settles an identity without the card, so it never brings a number back.
  it("an identity a nameplate photo settled reads no ticked number; control: the card-settled one does", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    const counted = async () => {
      const notebook = (await getNotebook(TENANT, nb))!;
      return numbersForMachine(await readConfirmedNumbers(TENANT, nb), null, notebook);
    };
    expect(await counted()).toEqual(["6AV2124-0GC01-0AX0"]); // control
    expect(await updateNotebook(TENANT, nb, { manufacturer: "", model: "", catalogNumber: "" })).toBe(true);
    expect(await adoptNameplateIdentity(TENANT, nb, "6085beef-0000-4000-8000-0000000000f1", { manufacturer: "Siemens", model: "TP700", catalogNumber: null })).toBe(true);
    expect(await status(nb)).toBe("user_confirmed"); // precondition: settled by the photo
    expect(await counted()).toEqual([]);
  });

  // A card confirm after the photo settled the identity is the card's first word on it: it decides
  // the numbers afresh, so the number ticked for the earlier identity does not come back.
  const settleByPhoto = async (nb: string) => {
    expect(await updateNotebook(TENANT, nb, { manufacturer: "", model: "", catalogNumber: "" })).toBe(true);
    expect(await adoptNameplateIdentity(TENANT, nb, "6085beef-0000-4000-8000-0000000000f2", { manufacturer: "Siemens", model: "TP700", catalogNumber: null })).toBe(true);
    expect(await status(nb)).toBe("user_confirmed");
  };
  it("after a photo settled the identity, an unticked card confirm brings no earlier number back", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    await settleByPhoto(nb);
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]); // precondition: still stored
    expect(await confirmNotebookIdentity(TENANT, nb, ID)).toEqual({ ok: true });
    expect(await scopeOf(nb, J2)).toBe("other");
  });
  it("after a photo settled the identity, a card confirm ticking another number saves that one only", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    await settleByPhoto(nb);
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]); // precondition: still stored
    expect(await confirmNotebookIdentity(TENANT, nb, ID, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb, J2_WRONG)).toBe("own");
    expect(await scopeOf(nb, J2)).toBe("other");
  });
  // Control: the card's first word after the photo is the only one. A stale card after it, ticked
  // with any number, changes nothing.
  it("control: after a photo settle and one unticked card confirm, a stale ticked card is refused", async () => {
    const nb = await makeBlank();
    await settleByPhoto(nb);
    expect(await confirmNotebookIdentity(TENANT, nb, ID)).toEqual({ ok: true });
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: false });
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
  });

  // #6104 r1 F4: an entry the scope cannot use (no order number in it) neither blocks a usable
  // number nor stands in for one, so numberSaved true always means the thread can settle.
  it("a saved entry with no usable order number does not block or satisfy a usable one", async () => {
    const nb = await makeBlank([{ number: "6AV21240GC010AX0", manufacturer: "Siemens", model: "TP700", confirmedAt: "2026-11-27T00:00:00.000Z" }]);
    expect(threadStatusScope([J2], { ...ENTRY, catalogNumber: "", recordCatalog: null, confirmedNumbers: numbersForIdentity(await readConfirmedNumbers(TENANT, nb), ENTRY) })).toBe("other"); // precondition
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb)).toBe("own");
  });

  // Pre-screen of round 3: a number belongs to the confirmation that ticked it. Settings changing
  // the model away and back reopens the identity; the next confirm decides afresh.
  it("a number does not outlive its identity: changed away and back, an unticked re-confirm brings none back", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await status(nb)).toBe("candidate"); // precondition: the identity is reopened
    expect(await updateNotebook(TENANT, nb, { model: "TP700" })).toBe(true);
    expect(await status(nb)).toBe("candidate");
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]); // precondition: still stored
    expect(await confirmNotebookIdentity(TENANT, nb, ID)).toEqual({ ok: true });
    expect(await status(nb)).toBe("user_confirmed");
    expect(await scopeOf(nb, J2)).toBe("other");
  });

  it("changed away and back, a re-confirm ticking another number saves that one and only that one", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await updateNotebook(TENANT, nb, { model: "TP700" })).toBe(true);
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]); // precondition: still stored
    expect(await confirmNotebookIdentity(TENANT, nb, ID, OTHER_NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb, J2_WRONG)).toBe("own");
    expect(await scopeOf(nb, J2)).toBe("other");
  });

  // Pre-screen 2 of round 3: the notebook PATCH can also write the identity status or source by
  // hand (raw API; no shipped client sends one). A status or source written by hand drops the
  // ticked numbers: only the identity card adds one.
  it("a PATCH that writes the identity status by hand drops the ticked number: changed away and back, it counts none", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await scopeOf(nb, J2)).toBe("own"); // precondition: the tick counts
    expect(await updateNotebook(TENANT, nb, { model: "TP900" })).toBe(true);
    expect(await updateNotebook(TENANT, nb, { model: "TP700", identityStatus: "user_confirmed" })).toBe(true);
    expect(await status(nb)).toBe("user_confirmed"); // precondition: settled again, by hand
    expect(await source(nb)).toBe("user");
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    expect(await scopeOf(nb, J2)).toBe("other");
  });

  it("a PATCH that writes the identity source by hand drops the ticked number", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    await settleByPhoto(nb);
    expect(await updateNotebook(TENANT, nb, { identitySourceType: "user" })).toBe(true);
    expect(await status(nb)).toBe("user_confirmed"); // precondition: the read predicate holds
    expect(await source(nb)).toBe("user");
    expect(await readConfirmedNumbers(TENANT, nb)).toEqual([]);
    expect(await scopeOf(nb, J2)).toBe("other");
  });

  // Control: a PATCH that writes no identity status or source (a rename) keeps the number.
  it("control: a PATCH that renames the notebook keeps the number", async () => {
    const nb = await makeBlank();
    expect(await confirmNotebookIdentity(TENANT, nb, ID, NUMBER)).toEqual({ ok: true, numberSaved: true });
    expect(await updateNotebook(TENANT, nb, { displayName: "Line 3 HMI" })).toBe(true);
    expect(await codes(nb)).toEqual(["6AV21240GC010AX0"]);
    expect(await scopeOf(nb, J2)).toBe("own");
  });
});
