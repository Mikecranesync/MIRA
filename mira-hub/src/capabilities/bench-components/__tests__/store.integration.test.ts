/**
 * Bench component store against real Postgres: the real withTenantContext
 * (SET LOCAL ROLE factorylm_app + RLS) on a disposable database, migration 115
 * applied from db/migrations (twice: idempotency).
 *
 * Run (disposable DB only; the integration schema must already hold 073–089):
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55441/bench MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *     npx vitest run --config vitest.integration.config.ts src/capabilities/bench-components
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID as uuid } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 6 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import {
  addComponent,
  advanceSelectionRevision,
  getSelection,
  getSelectionState,
  getSelectionVersion,
  listComponents,
  listSelectionTurns,
  reviseComponent,
  setSelection,
  stampTurnComponent,
  turnsAskedUnderComponent,
} from "../store";
import { readRevisionInput, type ComponentRevisionInput } from "../validate";
import { readSubjectUnderSelection } from "../selection";
import { SEED_USER, runSeed, seedInputs, type InventoryRow } from "../seed";
import { SAME_SERIAL_SQL, sameSerialAdvisory } from "../same-serial";
import { withTenantContext } from "@/lib/tenant-context";

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/115_bench_components.sql");
const USER = "user-tech-1";

async function makeNotebook(tenantId: string): Promise<string> {
  const res = await testPool.query<{ id: string }>(
    `INSERT INTO equipment_notebooks (tenant_id, node_id, display_name) VALUES ($1::uuid, $2::uuid, 'bench test')
     RETURNING id::text AS id`,
    [tenantId, uuid()],
  );
  return res.rows[0]!.id;
}

function rev(body: Record<string, unknown>, confirm = false): ComponentRevisionInput {
  const read = readRevisionInput(body, confirm);
  if ("error" in read) throw new Error(read.error);
  return read;
}

const GS10 = { rawLabel: "GS11N-20P2", inputKind: "typed", manufacturer: "AutomationDirect", family: "GS10", catalogNumber: "GS11N-20P2", hardwareRevision: "1.03", localTag: "VFD1" };

/** A completed turn, created at the database's now() exactly as the claim writes it. */
async function turn(tenantId: string, notebookId: string, question: string, threadId: string | null) {
  const id = uuid();
  await testPool.query(
    `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_status, owner_user_id, thread_id,
       client_request_id, client_request_state)
     VALUES ($1::uuid, $2::uuid, $3, 'insufficient_evidence', $4, $5, $6::uuid, 'complete')`,
    [notebookId, tenantId, question, USER, threadId, id],
  );
  return id;
}

const run = process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" ? describe : describe.skip;

run("bench component store (real Postgres, RLS)", () => {
  const tenantA = uuid();
  const tenantB = uuid();
  let notebookA: string;
  let otherNotebookA: string;
  let notebookB: string;

  beforeAll(async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    await testPool.query(sql);
    await testPool.query(sql);
    notebookA = await makeNotebook(tenantA);
    otherNotebookA = await makeNotebook(tenantA);
    notebookB = await makeNotebook(tenantB);
  });
  afterAll(async () => {
    await testPool.end();
  });

  it("adds a component with its first revision once; a retried add returns it and writes nothing", async () => {
    const key = uuid();
    const first = await addComponent(tenantA, notebookA, USER, { clientRequestId: key, kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    expect(first.status).toBe("created");
    const again = await addComponent(tenantA, notebookA, USER, { clientRequestId: key, kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    expect(again.status).toBe("existing");
    const rows = await testPool.query(`SELECT count(*)::int AS n FROM notebook_components WHERE client_request_id = $1::uuid`, [key]);
    expect(rows.rows[0].n).toBe(1);
    const revs = await testPool.query(`SELECT count(*)::int AS n FROM notebook_component_revisions WHERE client_request_id = $1::uuid`, [key]);
    expect(revs.rows[0].n).toBe(1);
  });

  it("a reused request id with different content is a conflict, not the earlier success", async () => {
    const key = uuid();
    await addComponent(tenantA, notebookA, USER, { clientRequestId: key, kind: "relay", origin: "inventory", position: null, revision: null });
    const reused = await addComponent(tenantA, notebookA, USER, { clientRequestId: key, kind: "motor", origin: "inventory", position: null, revision: null });
    expect(reused.status).toBe("request_id_conflict");
  });

  it("an incomplete observation is saved as it is: unknown fields stay empty and listed", async () => {
    const added = await addComponent(tenantA, notebookA, USER, {
      clientRequestId: uuid(), kind: "photo_eye", origin: "device_schedule", position: null,
      revision: rev({ rawLabel: "B1 beam sensor", inputKind: "schedule", localTag: "B1", unresolved: ["manufacturer", "catalogNumber"], manufacturer: "guess" }),
    });
    if (added.status !== "created") throw new Error(added.status);
    expect(added.component.current).toMatchObject({ manufacturer: null, catalogNumber: null, localTag: "B1", identityStatus: "candidate", unresolved: ["manufacturer", "catalogNumber"] });
  });

  it("confirm writes one new revision; the same confirmation again writes nothing (not asked twice)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    if (added.status !== "created") throw new Error(added.status);
    const id = added.component.id;
    const confirmed = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev(GS10, true) });
    expect(confirmed.status).toBe("created");
    if (confirmed.status !== "created") throw new Error();
    expect(confirmed.component.current).toMatchObject({ revision: 2, identityStatus: "user_confirmed" });
    expect(confirmed.component.current?.confirmedAt).toBeTruthy();
    const repeat = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: uuid(), expectedRevision: 2, revision: rev(GS10, true) });
    expect(repeat.status).toBe("unchanged");
    const count = await testPool.query(`SELECT count(*)::int AS n FROM notebook_component_revisions WHERE component_id = $1::uuid`, [id]);
    expect(count.rows[0].n).toBe(2);
  });

  it("a save made against an older view is refused (two devices never silently overwrite)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    if (added.status !== "created") throw new Error();
    await reviseComponent(tenantA, notebookA, added.component.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev(GS10, true) });
    const stale = await reviseComponent(tenantA, notebookA, added.component.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, catalogNumber: "GS11N-20P5" }, true) });
    expect(stale.status).toBe("stale_revision");
  });

  it("selection: set, re-pick moves the boundary, version conflict, retry is a no-op, clear", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    const first = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    if (first.status !== "set") throw new Error(first.status);
    expect(first.selection).toMatchObject({ componentId: cid, revision: 1, version: 1 });
    const returnKey = uuid();
    const back = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "return", expectedVersion: 1, clientRequestId: returnKey });
    if (back.status !== "set") throw new Error(back.status);
    expect(back.selection.version).toBe(2);
    expect(Date.parse(back.selection.selectedAt)).toBeGreaterThan(Date.parse(first.selection.selectedAt));
    const retried = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "return", expectedVersion: 1, clientRequestId: returnKey });
    expect(retried).toMatchObject({ status: "existing", selection: { version: 2 } });
    const conflict = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: 1, clientRequestId: uuid() });
    expect(conflict.status).toBe("version_conflict");
    const cleared = await setSelection(tenantA, notebookA, USER, thread, { componentId: null, via: "picker", expectedVersion: 2, clientRequestId: uuid() });
    expect(cleared.status).toBe("cleared");
    expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull();
  });

  it("a pick carrying the record revision the technician saw is refused once the record was corrected (#5625 r1 F4)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    // Precondition: the record is now at revision 2 (corrected on another screen).
    const corrected = await reviseComponent(tenantA, notebookA, cid, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev(GS10, true) });
    expect(corrected.status).toBe("created");
    const stale = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, expectedRevision: 1, clientRequestId: uuid() });
    expect(stale).toEqual({ status: "stale_revision", selection: null });
    expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull();
    // Control: the revision on screen is the current one, so the pick is written at it.
    const current = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, expectedRevision: 2, clientRequestId: uuid() });
    if (current.status !== "set") throw new Error(current.status);
    expect(current.selection).toMatchObject({ componentId: cid, revision: 2, version: 1 });
  });

  it("a correction committed while the pick waits for the component lock is still seen: the pick is refused (#5625 r2 F4)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    // Another screen's correction: holds the component lock with revision 2 inserted, not yet committed.
    const other = await testPool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT 1 FROM notebook_components WHERE id = $1::uuid FOR UPDATE", [cid]);
      await other.query(
        `INSERT INTO notebook_component_revisions (tenant_id, component_id, revision, input_kind, identity_status, local_tag, client_request_id)
         VALUES ($1::uuid, $2::uuid, 2, 'typed', 'unknown', 'VFD1-corrected', $3::uuid)`,
        [tenantA, cid, uuid()],
      );
      const pick = setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, expectedRevision: 1, clientRequestId: uuid() });
      // Precondition: the pick is waiting on that lock (not finished, not ahead of it).
      await vi.waitFor(async () => {
        const waiting = await testPool.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted");
        expect(waiting.rows[0].n).toBeGreaterThan(0);
      }, { timeout: 5000, interval: 20 });
      await other.query("COMMIT");
      expect(await pick).toEqual({ status: "stale_revision", selection: null });
    } finally {
      other.release();
    }
    expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull();
  });

  it("two first picks on two screens at the same moment: one wins, the other is a conflict, never a silent overwrite", async () => {
    const make = async (body: Record<string, unknown>) => {
      const a = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(body, true) });
      if (a.status !== "created") throw new Error(a.status);
      return a.component.id;
    };
    const [one, two] = [await make(GS10), await make({ ...GS10, rawLabel: "GS11N-10P2", catalogNumber: "GS11N-10P2", localTag: "VFD2" })];
    for (let round = 0; round < 5; round++) {
      const thread = `race-${uuid().slice(0, 8)}`;
      expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull(); // precondition: no row yet
      const results = await Promise.all(
        [one, two].map((componentId) => setSelection(tenantA, notebookA, USER, thread, { componentId, via: "picker", expectedVersion: null, clientRequestId: uuid() })),
      );
      const set = results.filter((r) => r.status === "set");
      expect(set).toHaveLength(1);
      expect(results.filter((r) => r.status === "version_conflict")).toHaveLength(1);
      const stored = await getSelection(tenantA, notebookA, USER, thread);
      expect(stored).toMatchObject({ componentId: (set[0] as { selection: { componentId: string } }).selection.componentId, version: 1 });
    }
  });

  it("a clear keeps counting: a late retry of the first pick and a screen holding the old version are conflicts", async () => {
    const make = async (body: Record<string, unknown>) => {
      const a = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(body, true) });
      if (a.status !== "created") throw new Error(a.status);
      return a.component.id;
    };
    const [one, two] = [await make(GS10), await make({ ...GS10, rawLabel: "GS11N-10P2", catalogNumber: "GS11N-10P2", localTag: "VFD2" })];
    const thread = `clear-${uuid().slice(0, 8)}`;
    const firstKey = uuid();
    const first = await setSelection(tenantA, notebookA, USER, thread, { componentId: one, via: "picker", expectedVersion: null, clientRequestId: firstKey });
    expect(first).toMatchObject({ status: "set", selection: { version: 1 } });
    const clearKey = uuid();
    expect(await setSelection(tenantA, notebookA, USER, thread, { componentId: null, via: "picker", expectedVersion: 1, clientRequestId: clearKey })).toEqual({ status: "cleared" });
    expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull();
    expect(await getSelectionVersion(tenantA, notebookA, USER, thread)).toBe(2);
    // control: the clear itself, retried, is recognised and changes nothing
    expect(await setSelection(tenantA, notebookA, USER, thread, { componentId: null, via: "picker", expectedVersion: 1, clientRequestId: clearKey })).toEqual({ status: "cleared" });
    expect(await getSelectionVersion(tenantA, notebookA, USER, thread)).toBe(2);
    const lateRetry = await setSelection(tenantA, notebookA, USER, thread, { componentId: one, via: "picker", expectedVersion: null, clientRequestId: firstKey });
    expect(lateRetry).toMatchObject({ status: "version_conflict", selection: null });
    const staleScreen = await setSelection(tenantA, notebookA, USER, thread, { componentId: two, via: "picker", expectedVersion: 1, clientRequestId: uuid() });
    expect(staleScreen.status).toBe("version_conflict");
    expect(await getSelection(tenantA, notebookA, USER, thread)).toBeNull();
    const fresh = await setSelection(tenantA, notebookA, USER, thread, { componentId: two, via: "picker", expectedVersion: 2, clientRequestId: uuid() });
    expect(fresh).toMatchObject({ status: "set", selection: { componentId: two, version: 3 } });
  });

  // #5504 post-cap F9 against the real database: a pick whose transaction has not committed is
  // invisible to a checklist read, and the same request sent again waits for it and reports its
  // outcome — so only the re-sent request, never a read, can settle a lost reply.
  it("a pick still uncommitted: a read sees the old state; the same request re-sent returns the pick once it commits", async () => {
    const a = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (a.status !== "created") throw new Error(a.status);
    const thread = `pending-${uuid().slice(0, 8)}`;
    // A row exists (picked, then cleared): version 2, nothing selected.
    await setSelection(tenantA, notebookA, USER, thread, { componentId: a.component.id, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    await setSelection(tenantA, notebookA, USER, thread, { componentId: null, via: "picker", expectedVersion: 1, clientRequestId: uuid() });
    expect(await getSelectionState(tenantA, notebookA, USER, thread)).toEqual({ selection: null, version: 2 });

    // Another transaction holds the row, so the pick below stays pending inside its own transaction.
    const holder = await testPool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM notebook_thread_selections WHERE notebook_id = $1::uuid AND thread_key = $2 FOR UPDATE", [notebookA, thread]);
      const key = uuid();
      const pick = setSelection(tenantA, notebookA, USER, thread, { componentId: a.component.id, via: "picker", expectedVersion: 2, clientRequestId: key });
      const resent = setSelection(tenantA, notebookA, USER, thread, { componentId: a.component.id, via: "picker", expectedVersion: 2, clientRequestId: key });
      await new Promise((r) => setTimeout(r, 150));
      // The read the tablet's recovery would make: still the old, empty selection.
      expect(await getSelectionState(tenantA, notebookA, USER, thread)).toEqual({ selection: null, version: 2 });
      await holder.query("COMMIT");
      const [first, again] = await Promise.all([pick, resent]);
      expect(first).toMatchObject({ status: "set", selection: { componentId: a.component.id, version: 3 } });
      expect(again).toMatchObject({ status: "existing", selection: { componentId: a.component.id, version: 3 } });
    } finally {
      holder.release();
    }
    expect(await getSelectionState(tenantA, notebookA, USER, thread)).toMatchObject({ selection: { componentId: a.component.id, version: 3 }, version: 3 });
  });

  it("control: the same first pick sent twice at once is one selection, and both see it", async () => {
    const a = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (a.status !== "created") throw new Error(a.status);
    const thread = `retry-${uuid().slice(0, 8)}`;
    const key = uuid();
    const results = await Promise.all(
      [0, 1].map(() => setSelection(tenantA, notebookA, USER, thread, { componentId: a.component.id, via: "picker", expectedVersion: null, clientRequestId: key })),
    );
    expect(results.map((r) => r.status).sort()).toEqual(["existing", "set"]);
    expect(await getSelection(tenantA, notebookA, USER, thread)).toMatchObject({ componentId: a.component.id, version: 1 });
  });

  it("a component of another notebook or another tenant cannot be selected", async () => {
    const other = await addComponent(tenantA, otherNotebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (other.status !== "created") throw new Error();
    const wrongNotebook = await setSelection(tenantA, notebookA, USER, "t-x", { componentId: other.component.id, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    expect(wrongNotebook.status).toBe("component_not_found");
    const crossTenant = await setSelection(tenantB, notebookB, USER, "t-x", { componentId: other.component.id, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    expect(crossTenant.status).toBe("component_not_found");
    expect(await listComponents(tenantB, otherNotebookA)).toEqual([]);
    const intoForeign = await addComponent(tenantB, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: null });
    expect(intoForeign.status).toBe("notebook_not_found");
  });

  it("restart: turns are stamped, read back with their component, and the Return boundary holds after a fresh read", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    const sel = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    if (sel.status !== "set") throw new Error();
    const t1 = await turn(tenantA, notebookA, "what about the GS13N-20P2, same thing?", thread);
    expect(await stampTurnComponent(tenantA, notebookA, USER, t1, cid, 1)).toBe(true);
    const back = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "return", expectedVersion: 1, clientRequestId: uuid() });
    if (back.status !== "set") throw new Error();
    // A fresh read (as after a restart): the stored selection and stamped turns alone decide the carry.
    const selection = await getSelection(tenantA, notebookA, USER, thread);
    const turns = await listSelectionTurns(tenantA, notebookA, USER, thread, 6);
    expect(turns.map((t) => [t.componentId, t.componentRevision])).toEqual([[cid, 1]]);
    // The panel's read leaves each answer and its evidence behind; the chat route's history asks for them (#5504 Codex r2 F2).
    expect(turns.map((t) => [t.answerText, t.evidence])).toEqual([[null, []]]);
    await testPool.query(
      `UPDATE equipment_notebook_turns SET answer_text = 'ZQX saved answer', evidence = $2::jsonb WHERE client_request_id = $1::uuid`,
      [t1, JSON.stringify([{ kind: "component_attribution", componentId: cid, revision: 1, selectionVersion: 1, label: "VFD1" }])],
    );
    const withAnswers = await listSelectionTurns(tenantA, notebookA, USER, thread, 6, { withAnswers: true });
    expect(withAnswers.map((t) => [t.answerText, t.evidence])).toEqual([
      ["ZQX saved answer", [{ kind: "component_attribution", componentId: cid, revision: 1, selectionVersion: 1, label: "VFD1" }]],
    ]);
    expect(await listSelectionTurns(tenantB, notebookA, USER, thread, 6, { withAnswers: true })).toEqual([]);
    expect(readSubjectUnderSelection(turns, 6, selection!).questions).toEqual([]);
    // Control: under the first pick (before the Return) the same stamped turn does carry.
    expect(readSubjectUnderSelection(turns, 6, sel.selection).questions).toEqual(["what about the GS13N-20P2, same thing?"]);
    // The send wait reads the same stamp by turn id, so the detail route can tell this turn from a
    // whole-machine one even without an attribution entry (#5746 r5 F1). An unstamped turn is not
    // returned, and another tenant reads nothing.
    const whole = await turn(tenantA, notebookA, "what is the rated current of the GS11N-20P2?", thread);
    const rowIds = (await testPool.query(
      `SELECT id::text AS id FROM equipment_notebook_turns WHERE client_request_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [[t1, whole]],
    )).rows.map((r: { id: string }) => r.id);
    const stampedRow = withAnswers[0]!.id;
    expect(rowIds).toHaveLength(2);
    expect(rowIds).toContain(stampedRow);
    expect(await turnsAskedUnderComponent(tenantA, notebookA, rowIds)).toEqual(new Set([stampedRow]));
    expect(await turnsAskedUnderComponent(tenantB, notebookA, rowIds)).toEqual(new Set());
  });

  it("an identity correction re-points the selection at the new revision and moves the boundary", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    const sel = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    if (sel.status !== "set") throw new Error();
    const corrected = await reviseComponent(tenantA, notebookA, cid, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, catalogNumber: "GS11N-20P5" }, true) });
    if (corrected.status !== "created") throw new Error(corrected.status);
    expect(corrected.previous?.catalogNumber).toBe("GS11N-20P2");
    const moved = await advanceSelectionRevision(tenantA, notebookA, USER, thread, 1, 2);
    expect(moved).toMatchObject({ revision: 2, selectedVia: "correction", version: 2 });
    expect(await advanceSelectionRevision(tenantA, notebookA, USER, thread, 1, 2)).toBeNull();
  });

  it("a label-only or note-only correction is saved as a new revision; a reused id with another label is a conflict (#5504 Codex F3)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (added.status !== "created") throw new Error();
    const id = added.component.id;
    const req = uuid();
    const relabel = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: req, expectedRevision: 1, revision: rev({ ...GS10, rawLabel: "GS11N-20P2 S/N 77" }, true) });
    expect(relabel.status).toBe("created");
    if (relabel.status !== "created") throw new Error();
    expect(relabel.component.current).toMatchObject({ revision: 2, rawLabel: "GS11N-20P2 S/N 77" });
    const renote = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: uuid(), expectedRevision: 2, revision: rev({ ...GS10, rawLabel: "GS11N-20P2 S/N 77", evidenceNote: "read off the door" }, true) });
    expect(renote.status).toBe("created");
    // The same request id carrying a different label is not the earlier success.
    const reused = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: req, expectedRevision: 1, revision: rev({ ...GS10, rawLabel: "something else" }, true) });
    expect(reused.status).toBe("request_id_conflict");
    // Control: an exact repeat still writes nothing.
    const repeat = await reviseComponent(tenantA, notebookA, id, USER, { clientRequestId: uuid(), expectedRevision: 3, revision: rev({ ...GS10, rawLabel: "GS11N-20P2 S/N 77", evidenceNote: "read off the door" }, true) });
    expect(repeat.status).toBe("unchanged");
    const count = await testPool.query(`SELECT count(*)::int AS n FROM notebook_component_revisions WHERE component_id = $1::uuid`, [id]);
    expect(count.rows[0].n).toBe(3);
  });

  it("a correction noticed by a question moves the boundary to just before that question, so the question itself carries (#5504 Codex F4)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "drive", origin: "inventory", position: null, revision: rev(GS10, true) });
    if (added.status !== "created") throw new Error();
    const cid = added.component.id;
    const thread = `t-${uuid().slice(0, 8)}`;
    const sel = await setSelection(tenantA, notebookA, USER, thread, { componentId: cid, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    if (sel.status !== "set") throw new Error();
    const corrected = await reviseComponent(tenantA, notebookA, cid, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, catalogNumber: "GS11N-20P5" }, true) });
    if (corrected.status !== "created") throw new Error(corrected.status);
    const asking = await turn(tenantA, notebookA, "what is P00.02", thread);
    const created = await testPool.query(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM equipment_notebook_turns WHERE client_request_id = $1::uuid`, [asking]);
    const moved = await advanceSelectionRevision(tenantA, notebookA, USER, thread, 1, 2, asking);
    expect(moved).toMatchObject({ revision: 2, selectedVia: "correction" });
    expect(moved!.selectedAt < created.rows[0].at).toBe(true);
    // Control: with no triggering question the boundary is the moment of the correction.
    const thread2 = `t-${uuid().slice(0, 8)}`;
    const sel2 = await setSelection(tenantA, notebookA, USER, thread2, { componentId: cid, via: "picker", expectedVersion: null, clientRequestId: uuid() });
    if (sel2.status !== "set") throw new Error();
    const again = await reviseComponent(tenantA, notebookA, cid, USER, { clientRequestId: uuid(), expectedRevision: 2, revision: rev({ ...GS10, catalogNumber: "GS11N-20P7" }, true) });
    if (again.status !== "created") throw new Error(again.status);
    const plain = await advanceSelectionRevision(tenantA, notebookA, USER, thread2, 1, 3);
    expect(plain).toMatchObject({ revision: 3 });
    expect(plain!.selectedAt > created.rows[0].at).toBe(true);
  });

  it("the provisional inventory seeds once: a second run adds nothing, every row unconfirmed; another tenant cannot seed this project", async () => {
    const inventory = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../scripts/data/cv101-provisional-inventory.json"), "utf8")) as { rows: InventoryRow[] };
    const nb = await makeNotebook(tenantA);
    const inputs = seedInputs(nb, inventory.rows);
    // Each run computes its rows afresh, as a second invocation of the script does.
    const seed = (tenant: string) =>
      runSeed(
        (i) => addComponent(tenant, nb, SEED_USER, { clientRequestId: i.clientRequestId, kind: i.kind, origin: i.origin, position: i.position, revision: i.revision }),
        seedInputs(nb, inventory.rows),
      );
    const first = await seed(tenantA);
    expect(first.map((o) => o.status)).toEqual(inputs.map(() => "created"));
    const second = await seed(tenantA);
    expect(second.map((o) => o.status)).toEqual(inputs.map(() => "existing"));
    const listed = await listComponents(tenantA, nb);
    expect(listed).toHaveLength(inventory.rows.length);
    const revs = await testPool.query(
      `SELECT count(*)::int AS n FROM notebook_component_revisions r JOIN notebook_components c ON c.id = r.component_id WHERE c.notebook_id = $1::uuid`,
      [nb],
    );
    expect(revs.rows[0].n).toBe(inventory.rows.length);
    for (const c of listed) {
      expect(c.current).toMatchObject({ identityStatus: "unknown", rawLabel: null, manufacturer: null, catalogNumber: null, serialNumber: null, confirmedAt: null });
      expect(c.current!.evidenceNote).toBe(inventory.rows[c.position].note);
    }
    expect(listed.map((c) => c.current!.localTag)).toEqual(inventory.rows.map((r) => r.localTag));
    // Isolation: tenant B cannot write into tenant A's project.
    expect((await seed(tenantB))[0].status).toBe("notebook_not_found");
    expect(await listComponents(tenantA, nb)).toHaveLength(inventory.rows.length);
  });

  it("a seed rerun after a technician confirmed a row still finds every row; a changed row is a conflict", async () => {
    const inventory = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../scripts/data/cv101-provisional-inventory.json"), "utf8")) as { rows: InventoryRow[] };
    const nb = await makeNotebook(tenantA);
    const seed = (rows: InventoryRow[]) =>
      runSeed(
        (i) => addComponent(tenantA, nb, SEED_USER, { clientRequestId: i.clientRequestId, kind: i.kind, origin: i.origin, position: i.position, revision: i.revision }),
        seedInputs(nb, rows),
      );
    await seed(inventory.rows);
    const vfd = (await listComponents(tenantA, nb)).find((c) => c.current!.localTag === "VFD1")!;
    const confirmed = await reviseComponent(tenantA, nb, vfd.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev(GS10, true) });
    expect(confirmed.status).toBe("created");
    const again = await seed(inventory.rows);
    expect(again.map((o) => o.status)).toEqual(inventory.rows.map(() => "existing"));
    // The confirmation is kept, not rewritten by the seed.
    expect((await listComponents(tenantA, nb)).find((c) => c.id === vfd.id)!.current).toMatchObject({ revision: 2, identityStatus: "user_confirmed" });
    // Control: the same request id with a different identity is still refused (the
    // evidence note is not identity, so editing it alone is not a conflict).
    const edited = inventory.rows.map((r) => (r.key === "PLC1" ? { ...r, localTag: "PLC9" } : r));
    expect((await seed(edited))[0].status).toBe("request_id_conflict");
  });

  it("an add without a first revision, corrected later, is still found when the add is retried", async () => {
    const request = uuid();
    const add = () => addComponent(tenantA, notebookA, USER, { clientRequestId: request, kind: "relay", origin: "technician", position: null, revision: null });
    const added = await add();
    if (added.status !== "created") throw new Error(added.status);
    await reviseComponent(tenantA, notebookA, added.component.id, USER, { clientRequestId: uuid(), expectedRevision: 0, revision: rev(GS10, false) });
    const retried = await add();
    expect(retried.status).toBe("existing");
    if (retried.status !== "existing") throw new Error();
    expect(retried.component.id).toBe(added.component.id);
  });

  it("the database refuses a confirmed revision without a confirmation time (CHECK)", async () => {
    const added = await addComponent(tenantA, notebookA, USER, { clientRequestId: uuid(), kind: "x", origin: "inventory", position: null, revision: null });
    if (added.status !== "created") throw new Error();
    await expect(
      testPool.query(
        `INSERT INTO notebook_component_revisions (tenant_id, component_id, revision, input_kind, identity_status, client_request_id)
         VALUES ($1::uuid, $2::uuid, 1, 'typed', 'user_confirmed', $3::uuid)`,
        [tenantA, added.component.id, uuid()],
      ),
    ).rejects.toThrow(/notebook_component_revisions_confirmed_chk/);
  });

  // ---- the repeated-serial advisory (each case: its own tenant, its own random serial) ----

  async function namedNotebook(tenantId: string, name: string): Promise<string> {
    const id = await makeNotebook(tenantId);
    await testPool.query(`UPDATE equipment_notebooks SET display_name = $1 WHERE id = $2::uuid AND tenant_id = $3::uuid`, [name, id, tenantId]);
    return id;
  }
  /** A serial no other case uses, and the same serial typed another way (case, spaces, dash). */
  function serialPair() {
    const hex = uuid().replace(/-/g, "").slice(0, 10);
    return { typed: `SN-${hex.toUpperCase()}`, retyped: `sn ${hex.slice(0, 4)} ${hex.slice(4)}`, folded: `sn${hex}` };
  }
  async function confirmedUnit(tenantId: string, notebookId: string, serial: string | null, over: Record<string, unknown> = {}) {
    const added = await addComponent(tenantId, notebookId, USER, {
      clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision: rev({ ...GS10, serialNumber: serial, ...over }, true),
    });
    if (added.status !== "created") throw new Error(added.status);
    return added.component;
  }
  const ids = (advisory: Awaited<ReturnType<typeof sameSerialAdvisory>>) => (advisory.status === "checked" ? advisory.candidates.map((c) => c.componentId) : advisory.status);

  it("same serial: two confirmed components of one tenant in different projects with the same serial, typed differently, warn about each other", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed, { localTag: "VFD1" });
    const b = await confirmedUnit(tenant, nb2, s.retyped, { localTag: "VFD2" });
    expect(await sameSerialAdvisory(tenant, b)).toEqual({
      status: "checked",
      candidates: [{ componentId: a.id, notebookId: nb1, notebookName: "Line 1", label: "VFD1 · AutomationDirect GS11N-20P2", retired: false }],
      truncated: false,
    });
    expect(await sameSerialAdvisory(tenant, a)).toEqual({
      status: "checked",
      candidates: [{ componentId: b.id, notebookId: nb2, notebookName: "Line 2", label: "VFD2 · AutomationDirect GS11N-20P2", retired: false }],
      truncated: false,
    });
  });

  it("same serial: the same tag, manufacturer and catalog number with a different serial, or with no serial, is not a candidate", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed);
    const b = await confirmedUnit(tenant, nb2, s.retyped);
    const differentSerial = await confirmedUnit(tenant, nb2, serialPair().typed);
    const noSerial = await confirmedUnit(tenant, nb2, null);
    expect(differentSerial.current).toMatchObject({ localTag: "VFD1", manufacturer: "AutomationDirect", catalogNumber: "GS11N-20P2" });
    expect(noSerial.current).toMatchObject({ localTag: "VFD1", manufacturer: "AutomationDirect", catalogNumber: "GS11N-20P2", serialNumber: null });
    expect(ids(await sameSerialAdvisory(tenant, b))).toEqual([a.id]);
    expect(ids(await sameSerialAdvisory(tenant, a))).toEqual([b.id]);
  });

  it("same serial: a component never lists itself, also after a note-only correction", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed);
    const b = await confirmedUnit(tenant, nb2, s.retyped);
    expect(ids(await sameSerialAdvisory(tenant, b))).toEqual([a.id]);
    const corrected = await reviseComponent(tenant, nb2, b.id, USER, {
      clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, serialNumber: s.retyped, evidenceNote: "read off the nameplate" }, true),
    });
    if (corrected.status !== "created") throw new Error(corrected.status);
    expect(corrected.component.current?.revision).toBe(2);
    expect(ids(await sameSerialAdvisory(tenant, corrected.component))).toEqual([a.id]);
  });

  it("same serial: a serial corrected away or cleared on the other component no longer warns (and warned before)", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed);
    const b = await confirmedUnit(tenant, nb2, s.retyped);
    expect(ids(await sameSerialAdvisory(tenant, b))).toEqual([a.id]);
    const corrected = await reviseComponent(tenant, nb1, a.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, serialNumber: serialPair().typed }, true) });
    expect(corrected.status).toBe("created");
    expect(await sameSerialAdvisory(tenant, b)).toEqual({ status: "checked", candidates: [], truncated: false });

    const s2 = serialPair();
    const c = await confirmedUnit(tenant, nb1, s2.typed);
    const d = await confirmedUnit(tenant, nb2, s2.retyped);
    expect(ids(await sameSerialAdvisory(tenant, d))).toEqual([c.id]);
    const cleared = await reviseComponent(tenant, nb1, c.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10 }, true) });
    expect(cleared.status === "created" && cleared.component.current?.serialNumber).toBeNull();
    expect(await sameSerialAdvisory(tenant, d)).toEqual({ status: "checked", candidates: [], truncated: false });
  });

  it("same serial: another tenant's component with the same serial is never listed, by the predicate and not by an empty table", async () => {
    const tenantA = uuid();
    const tenantB = uuid();
    const nbA = await namedNotebook(tenantA, "A's line");
    const nbB = await namedNotebook(tenantB, "B's line");
    const s = serialPair();
    const mine = await confirmedUnit(tenantA, nbA, s.typed);
    const theirs = await confirmedUnit(tenantB, nbB, s.retyped);
    expect(await sameSerialAdvisory(tenantA, mine)).toEqual({ status: "checked", candidates: [], truncated: false });
    // On the owner connection RLS is bypassed, so only the explicit tenant predicate is under test.
    const own = await testPool.query(SAME_SERIAL_SQL, [tenantA, mine.id, s.typed, 11]);
    expect(own.rows.map((r) => r.id)).toEqual([]);
    const control = await testPool.query(SAME_SERIAL_SQL, [tenantB, mine.id, s.typed, 11]);
    expect(control.rows.map((r) => r.id)).toEqual([theirs.id]);
    // And the row-level policy alone: inside tenant A's transaction the same statement, asked for tenant
    // B's rows outright, sees none, while tenant B's own transaction does see it (so it is the policy
    // refusing, not a missing grant).
    const read = (as: string) => withTenantContext(as, (c) => c.query(SAME_SERIAL_SQL, [tenantB, mine.id, s.typed, 11]), { readOnly: true });
    expect((await read(tenantA)).rows).toEqual([]);
    expect((await read(tenantB)).rows.map((r) => r.id)).toEqual([theirs.id]);
  });

  it("same serial: a retired component with the same serial is still listed, marked as retired", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed);
    const b = await confirmedUnit(tenant, nb2, s.retyped);
    await testPool.query(`UPDATE notebook_components SET retired_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid`, [a.id, tenant]);
    expect(await sameSerialAdvisory(tenant, b)).toEqual({
      status: "checked",
      candidates: [{ componentId: a.id, notebookId: nb1, notebookName: "Line 1", label: "VFD1 · AutomationDirect GS11N-20P2", retired: true }],
      truncated: false,
    });
  });

  it("same serial: eleven other components with the same serial list ten and say there are more", async () => {
    const tenant = uuid();
    const nb = await namedNotebook(tenant, "Line 1");
    const s = serialPair();
    const others: string[] = [];
    for (let i = 0; i < 11; i++) others.push((await confirmedUnit(tenant, nb, i % 2 ? s.typed : s.retyped)).id);
    // Known ages in an order that is neither the insert order nor its reverse, with one tie, so which ten
    // are shown can only come from the stated order: newest first, then by id.
    const minutes = [5, 0, 9, 2, 7, 10, 1, 8, 3, 6, 6];
    for (let i = 0; i < 11; i++) {
      await testPool.query(
        `UPDATE notebook_components SET created_at = timestamptz '2026-01-01T00:00:00Z' + make_interval(mins => $1::int) WHERE id = $2::uuid AND tenant_id = $3::uuid`,
        [minutes[i], others[i], tenant],
      );
    }
    const newestFirst = others
      .map((id, i) => ({ id, age: minutes[i]! }))
      .sort((x, y) => y.age - x.age || (x.id < y.id ? -1 : 1))
      .map((x) => x.id);
    const subject = await confirmedUnit(tenant, nb, s.typed);
    const out = await sameSerialAdvisory(tenant, subject);
    expect(out).toMatchObject({ status: "checked", truncated: true });
    expect(ids(out)).toEqual(newestFirst.slice(0, 10));
    expect(newestFirst[10]).toBe(others[1]);
  });

  it("same serial: right after a confirm is saved, the advisory sees the committed save and the other component", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb1, s.typed);
    const added = await addComponent(tenant, nb2, USER, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision: rev({ ...GS10, serialNumber: s.retyped }, false) });
    if (added.status !== "created") throw new Error(added.status);
    expect(await sameSerialAdvisory(tenant, added.component)).toEqual({ status: "not_checked", reason: "not_confirmed" });
    const confirmed = await reviseComponent(tenant, nb2, added.component.id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, serialNumber: s.retyped }, true) });
    if (confirmed.status !== "created") throw new Error(confirmed.status);
    const out = await sameSerialAdvisory(tenant, confirmed.component);
    expect(out).toMatchObject({ status: "checked", truncated: false });
    expect(ids(out)).toEqual([a.id]);
  });

  it("same serial: the revision a save answers with is the revision the checklist then shows; a later correction shows a greater one", async () => {
    // The screen keeps a repeated-serial warning only while the checklist's revision of the saved
    // component is not greater than the one the save answered with (#5656). That rule is sound only
    // if the two numbers come out equal for an ordinary save, which is what this reads from the database.
    const tenant = uuid();
    const nb = await namedNotebook(tenant, "Line 1");
    const s = serialPair();
    const added = await addComponent(tenant, nb, USER, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision: rev({ ...GS10, localTag: "VFD1" }, false) });
    if (added.status !== "created") throw new Error(added.status);
    const id = added.component.id;
    const shown = async () => (await listComponents(tenant, nb)).find((c) => c.id === id)!.current!.revision;
    const save = (expectedRevision: number, over: Record<string, unknown> = {}) =>
      reviseComponent(tenant, nb, id, USER, { clientRequestId: uuid(), expectedRevision, revision: rev({ ...GS10, localTag: "VFD1", serialNumber: s.typed, ...over }, true) });

    const confirmed = await save(1);
    if (confirmed.status !== "created") throw new Error(confirmed.status);
    expect(confirmed.component.current!.revision).toBe(2);
    expect(await shown()).toBe(confirmed.component.current!.revision);

    // The same confirmation again writes nothing and answers with the same revision.
    const again = await save(2);
    if (again.status !== "unchanged") throw new Error(again.status);
    expect(again.component.current!.revision).toBe(2);
    expect(await shown()).toBe(2);

    const corrected = await save(2, { hardwareRevision: "1.04" });
    if (corrected.status !== "created") throw new Error(corrected.status);
    expect(await shown()).toBe(3);
    expect(await shown()).toBeGreaterThan(confirmed.component.current!.revision);
  });

  it("same serial: the same serial AND the same label in two tenants: neither is told about the other's component", async () => {
    const [t1, t2] = [uuid(), uuid()];
    const [nb1, nb2] = [await namedNotebook(t1, "Line 1"), await namedNotebook(t2, "Line 1")];
    const s = serialPair();
    const mine = await confirmedUnit(t1, nb1, s.typed, { localTag: "VFD1" });
    const theirs = await confirmedUnit(t2, nb2, s.typed, { localTag: "VFD1" });
    expect(await sameSerialAdvisory(t1, mine)).toEqual({ status: "checked", candidates: [], truncated: false });
    expect(await sameSerialAdvisory(t2, theirs)).toEqual({ status: "checked", candidates: [], truncated: false });
    // Control: a twin inside tenant 1 is listed, so the empty answers above are the tenant boundary and
    // not a lookup that finds nothing. Tenant 2 still hears nothing of either.
    const twin = await confirmedUnit(t1, nb1, s.typed, { localTag: "VFD1" });
    expect(await sameSerialAdvisory(t1, twin)).toEqual({
      status: "checked",
      candidates: [{ componentId: mine.id, notebookId: nb1, notebookName: "Line 1", label: "VFD1 · AutomationDirect GS11N-20P2", retired: false }],
      truncated: false,
    });
    expect(ids(await sameSerialAdvisory(t2, theirs))).toEqual([]);
  });

  it("same serial: in the store, confirming a repeated serial and looking it up leave the other record exactly as it was (nothing is merged)", async () => {
    const tenant = uuid();
    const nb = await namedNotebook(tenant, "Line 1");
    const s = serialPair();
    const a = await confirmedUnit(tenant, nb, s.typed, { localTag: "VFD1" });
    const records = async () =>
      (await testPool.query(
        `SELECT c.id::text AS id, c.notebook_id::text AS notebook_id, c.retired_at,
                (SELECT count(*)::int FROM notebook_component_revisions r WHERE r.component_id = c.id) AS revisions,
                (SELECT md5(string_agg(r::text, '|' ORDER BY r.revision)) FROM notebook_component_revisions r WHERE r.component_id = c.id) AS content
           FROM notebook_components c WHERE c.tenant_id = $1::uuid ORDER BY c.created_at, c.id`,
        [tenant],
      )).rows;
    const before = await records();
    expect(before).toHaveLength(1);

    const b = await confirmedUnit(tenant, nb, s.retyped, { localTag: "VFD1" });
    expect(ids(await sameSerialAdvisory(tenant, b))).toEqual([a.id]);
    expect(ids(await sameSerialAdvisory(tenant, a))).toEqual([b.id]);

    const after = await records();
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.id === a.id)).toEqual(before[0]);
    expect(after.find((r) => r.id === b.id)).toMatchObject({ notebook_id: nb, retired_at: null, revisions: 1 });
  });

  it("same serial: two confirms of one component sent at the same moment: one is saved, the other is refused, and the saved one gets its advisory", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const other = await confirmedUnit(tenant, nb1, s.typed, { localTag: "VFD1" });
    const added = await addComponent(tenant, nb2, USER, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision: rev({ ...GS10, localTag: "VFD2" }, false) });
    if (added.status !== "created") throw new Error(added.status);
    const send = (hardwareRevision: string) =>
      reviseComponent(tenant, nb2, added.component.id, USER, {
        clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, localTag: "VFD2", serialNumber: s.retyped, hardwareRevision }, true),
      });
    const results = await Promise.all([send("1.03"), send("1.04")]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "stale_revision"]);
    const won = results.find((r) => r.status === "created");
    if (!won || won.status !== "created") throw new Error("no save won");
    expect(won.component.current).toMatchObject({ revision: 2, identityStatus: "user_confirmed" });
    expect(ids(await sameSerialAdvisory(tenant, won.component))).toEqual([other.id]);
    const count = await testPool.query(`SELECT count(*)::int AS n FROM notebook_component_revisions WHERE component_id = $1::uuid`, [added.component.id]);
    expect(count.rows[0].n).toBe(2);
  });

  it("same serial: two different components confirmed with one serial at the same moment: at least one of them is told about the other", async () => {
    const tenant = uuid();
    const [nb1, nb2] = [await namedNotebook(tenant, "Line 1"), await namedNotebook(tenant, "Line 2")];
    const s = serialPair();
    const draft = async (nb: string, tag: string) => {
      const added = await addComponent(tenant, nb, USER, { clientRequestId: uuid(), kind: "drive", origin: "technician", position: null, revision: rev({ ...GS10, localTag: tag }, false) });
      if (added.status !== "created") throw new Error(added.status);
      return added.component;
    };
    const [a, b] = [await draft(nb1, "VFD1"), await draft(nb2, "VFD2")];
    // Each save is followed by its own lookup, as the route runs them.
    const confirmThenLook = async (nb: string, id: string, tag: string, serial: string) => {
      const saved = await reviseComponent(tenant, nb, id, USER, { clientRequestId: uuid(), expectedRevision: 1, revision: rev({ ...GS10, localTag: tag, serialNumber: serial }, true) });
      if (saved.status !== "created") throw new Error(saved.status);
      return ids(await sameSerialAdvisory(tenant, saved.component));
    };
    for (let round = 0; round < 5; round += 1) {
      const pair = round === 0 ? [a, b] : [await draft(nb1, "VFD1"), await draft(nb2, "VFD2")];
      const serial = round === 0 ? s : serialPair();
      const [seenByA, seenByB] = await Promise.all([
        confirmThenLook(nb1, pair[0].id, "VFD1", serial.typed),
        confirmThenLook(nb2, pair[1].id, "VFD2", serial.retyped),
      ]);
      // A lookup starts after its own save has committed, so the later of the two always sees the earlier.
      expect([...seenByA, ...seenByB].some((id) => id === pair[0].id || id === pair[1].id)).toBe(true);
      expect(seenByA).not.toContain(pair[0].id);
      expect(seenByB).not.toContain(pair[1].id);
      // Both records stand: neither save was refused, blocked or folded into the other.
      const rows = await testPool.query(`SELECT count(*)::int AS n FROM notebook_components WHERE id = ANY($1::uuid[]) AND retired_at IS NULL`, [[pair[0].id, pair[1].id]]);
      expect(rows.rows[0].n).toBe(2);
    }
  });
});
