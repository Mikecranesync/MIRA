/**
 * Bench component store against real Postgres: the real withTenantContext
 * (SET LOCAL ROLE factorylm_app + RLS) on a disposable database, migration 115
 * applied from db/proposed (twice: idempotency).
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
  getSelectionVersion,
  listComponents,
  listSelectionTurns,
  reviseComponent,
  setSelection,
  stampTurnComponent,
} from "../store";
import { readRevisionInput, type ComponentRevisionInput } from "../validate";
import { readSubjectUnderSelection } from "../selection";
import { SEED_USER, runSeed, seedInputs, type InventoryRow } from "../seed";

const MIGRATION = path.resolve(__dirname, "../../../../db/proposed/115_bench_components.sql");
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
});
