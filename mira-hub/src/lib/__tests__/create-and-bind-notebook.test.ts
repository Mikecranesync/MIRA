/**
 * createAndBindNotebookTx — one transaction, or nothing (plan slice I4).
 *
 * The route test mocks this function away, so this is where its actual
 * behaviour is pinned. The failure it exists to prevent: create-then-bind as
 * two transactions commits a notebook and its backing kg_entities row before
 * the bind runs, so a failed bind leaves an orphan whose display name now
 * occupies the (tenant, type, name) natural key — and the retry 500s on the
 * duplicate. The second tap at the machine would be worse than the first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => {
  const pending: Array<{ ok: boolean; value: unknown }> = [];
  // Savepoint statements are transaction plumbing, not domain behaviour: the
  // backing-node INSERT is fenced by one (see lib/pg-unique-retry.ts), and a
  // strict call-order queue would otherwise have to encode them in every test.
  // `params` is declared so mock.calls is typed as [sql, params] — tests
  // assert on the bound parameters, not just the SQL.
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    if (/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(String(sql))) {
      return { rows: [] };
    }
    const next = pending.shift();
    if (!next) return { rows: [] };
    if (!next.ok) throw next.value;
    return next.value;
  });
  return { query, pending };
});

/** Queue results for the next real (non-savepoint) statements, in order. */
function queue(...results: unknown[]) {
  results.forEach((value) => clientMock.pending.push({ ok: true, value }));
}
/** Queue a rejection for the next real statement. */
function queueReject(err: unknown) {
  clientMock.pending.push({ ok: false, value: err });
}
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(clientMock)),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/document-readiness", () => ({ deriveReadiness: () => ({ canChat: true }) }));

import { createAndBindNotebookTx } from "../equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENTITY = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";

const VERIFIED_ASSET = {
  bind_key: ENTITY,
  name: "Discharge Conveyor",
  entity_type: "equipment",
  approval_state: "verified",
  uns_path: "enterprise.home_garage.conveyor_lab.conveyor_1",
};

const NOTEBOOK_ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "Discharge Conveyor",
  node_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-08-23T00:00:00Z",
  identity_status: "unknown",
  equipment_entity_id: ENTITY,
  asset_selected_via: "qr",
  asset_confirmed_by: null,
  asset_confirmed_at: null,
};

/** SQL issued so far, whitespace-collapsed. */
const sqlIssued = () =>
  clientMock.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
  clientMock.query.mockClear();
  clientMock.pending.length = 0;
});

describe("createAndBindNotebookTx", () => {
  it("returns the existing notebook without writing anything", async () => {
    queue(
      { rows: [VERIFIED_ASSET] },
      { rows: [NOTEBOOK_ROW] },
    );

    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" });

    expect(res).toMatchObject({ ok: true, created: false });
    expect(sqlIssued().some((s) => /INSERT INTO/i.test(s))).toBe(false);
  });

  it("creates the node and the notebook and binds them in one go", async () => {
    queue(
      { rows: [VERIFIED_ASSET] },
      { rows: [] }, // not yet bound
      { rows: [{ id: "33333333-3333-4333-8333-333333333333" }] },
      { rows: [NOTEBOOK_ROW] },
    );

    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr", createdBy: "u1" });

    expect(res).toMatchObject({ ok: true, created: true });
    const inserts = sqlIssued().filter((s) => /INSERT INTO/i.test(s));
    expect(inserts).toHaveLength(2);
    // The binding is set in the same INSERT — never a follow-up UPDATE that
    // could fail after the notebook is already committed.
    expect(inserts[1]).toMatch(/equipment_entity_id/);
    expect(inserts[1]).toMatch(/asset_selected_via/);
  });

it("binds a namespace-created node by its own id when entity_id is NULL", async () => {
    // The namespace API never sets entity_id, so `String(entity_id)` wrote the
    // literal string "null" into the binding — a value that looks bound and
    // resolves to nothing. coalesce(entity_id, id::text) is what the query
    // returns now, so the stub carries the resolved key.
    queue(
      { rows: [{ ...VERIFIED_ASSET, bind_key: "kg-row-uuid", entity_type: "asset" }] },
      { rows: [] },
      { rows: [{ id: "node-1" }] },
      { rows: [NOTEBOOK_ROW] },
    );

    await createAndBindNotebookTx(TENANT, "kg-row-uuid", { selectedVia: "qr" });
    // Found by SQL, not call index: the backing-node insert is savepoint-fenced,
    // so the position shifts whenever that plumbing changes.
    const insert = clientMock.query.mock.calls.find((c) =>
      /INSERT INTO equipment_notebooks/i.test(String(c[0])),
    )!;
    const params = insert[1] as unknown[];
    expect(params).toContain("kg-row-uuid");
    expect(params).not.toContain("null");
    expect(params.every((p) => p !== "undefined")).toBe(true);
  });

  it("a scan never pre-confirms the identity", async () => {
    queue(
      { rows: [VERIFIED_ASSET] },
      { rows: [] },
      { rows: [{ id: "n1" }] },
      { rows: [NOTEBOOK_ROW] },
    );

    await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" });
    const insert = sqlIssued().filter((s) => /INSERT INTO equipment_notebooks/i.test(s))[0];
    expect(insert).toMatch(/asset_confirmed_by, asset_confirmed_at\s*\)?[\s\S]*NULL, NULL/);
  });

  it("turns a NOTEBOOK unique violation into a race signal so the caller retries", async () => {
    // Only the equipment_notebooks insert means a genuine double-tap: the
    // partial-unique index from 081 is what a second tap actually hits.
    queue({ rows: [VERIFIED_ASSET] }, { rows: [] }, { rows: [{ id: "n1" }] });
    queueReject(Object.assign(new Error("duplicate key"), { code: "23505" }));

    await expect(createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" })).rejects.toMatchObject({
      code: "NOTEBOOK_RACE",
    });
  });

  it("absorbs a BACKING-NODE name collision instead of calling it a race", async () => {
    // The backing node is entity_type='equipment' named after the asset, which
    // is exactly what the asset's own identity node is called
    // (lib/knowledge-graph/asset-bridge.ts). Reporting that as NOTEBOOK_RACE
    // told the technician to "try again" forever — the name stays taken. It is
    // now retried under a savepoint with an internal, disambiguated name.
    queue({ rows: [VERIFIED_ASSET] }, { rows: [] });
    queueReject(Object.assign(new Error("duplicate key"), { code: "23505" }));
    queue({ rows: [{ id: "fallback-node" }] }, { rows: [NOTEBOOK_ROW] });

    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" });

    expect(res).toMatchObject({ ok: true, created: true });
    const nodeInserts = sqlIssued().filter((s) => /INSERT INTO kg_entities/i.test(s));
    expect(nodeInserts).toHaveLength(2); // first name taken, second disambiguated
    const names = clientMock.query.mock.calls
      .filter((c) => /INSERT INTO kg_entities/i.test(String(c[0])))
      .map((c) => (c[1] as unknown[])[0]);
    expect(names[0]).toBe("Discharge Conveyor");
    expect(String(names[1])).toMatch(/^Discharge Conveyor · notebook /);
  });

  it("refuses an area and writes nothing", async () => {
    queue(
      {
      rows: [{ ...VERIFIED_ASSET, entity_type: "area" }],
    },
    );
    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "asset_picker" });
    expect(res).toMatchObject({ ok: false, error: "asset_not_equipment" });
    expect(sqlIssued().some((s) => /INSERT INTO/i.test(s))).toBe(false);
  });

  it("refuses an unapproved asset and writes nothing — no orphan notebook", async () => {
    queue(
      {
      rows: [{ ...VERIFIED_ASSET, approval_state: "proposed" }],
    },
    );
    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "asset_picker" });
    expect(res).toMatchObject({ ok: false, error: "asset_not_verified" });
    expect(sqlIssued().some((s) => /INSERT INTO/i.test(s))).toBe(false);
  });

  it("refuses a verified asset with no uns_path", async () => {
    queue(
      { rows: [{ ...VERIFIED_ASSET, uns_path: null }] },
    );
    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "asset_picker" });
    expect(res).toMatchObject({ ok: false, error: "asset_not_verified" });
  });

  it("404s a foreign asset before any lookup of notebooks", async () => {
    queue(
      { rows: [] },
    );
    const res = await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" });
    expect(res).toMatchObject({ ok: false, error: "asset_not_found" });
    expect(clientMock.query).toHaveBeenCalledTimes(1);
  });

  it("gives the new node its own row — never the asset's bridge entity", async () => {
    queue(
      { rows: [VERIFIED_ASSET] },
      { rows: [] },
      { rows: [{ id: "fresh-node" }] },
      { rows: [NOTEBOOK_ROW] },
    );

    await createAndBindNotebookTx(TENANT, ENTITY, { selectedVia: "qr" });
    const nodeInsert = sqlIssued().filter((s) => /INSERT INTO kg_entities/i.test(s))[0];
    // uns_path NULL is correct, not a defect: node_id scopes DOCUMENTS, and the
    // machine's path is reached through equipment_entity_id.
    expect(nodeInsert).toMatch(/VALUES \('equipment', \$1, NULL/);
  });
});
