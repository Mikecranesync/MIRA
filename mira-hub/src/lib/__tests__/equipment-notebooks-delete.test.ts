/**
 * deleteNotebook — SQL contract for permanent notebook deletion.
 *
 * Run: npx vitest run src/lib/__tests__/equipment-notebooks-delete.test.ts
 *
 * These assert the SQL, not just the return value, because the database does
 * NOT enforce any of it: no dependent table declares a foreign key to
 * equipment_notebooks (073 keys by notebook_id with no FK; 075
 * workspace_file_links is polymorphic on target_type/target_id and cannot carry
 * one). There is therefore no ON DELETE CASCADE. If a future edit drops one of
 * these statements the rows are silently orphaned and a later notebook issued
 * the same UUID would adopt them — only these tests catch that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
let ownedRows: Record<string, unknown>[] = [];
let failOnDelete = false;
const deletedCounts: Record<string, number> = {};

function client() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT\s+id\s+FROM\s+equipment_notebooks/i.test(sql)) {
        return { rows: ownedRows, rowCount: ownedRows.length };
      }
      const table = /DELETE FROM (\w+)/i.exec(sql)?.[1] ?? "";
      if (table && failOnDelete) throw new Error("deadlock detected");
      const n = deletedCounts[table] ?? 0;
      return { rows: [], rowCount: n };
    }),
  };
}

let committed = false;
let rolledBack = false;

vi.mock("@/lib/tenant-context", () => ({
  // Mirrors the real helper: BEGIN/COMMIT around the callback, ROLLBACK on throw.
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => {
    committed = false;
    rolledBack = false;
    try {
      const out = await fn(client());
      committed = true;
      return out;
    } catch (e) {
      rolledBack = true;
      throw e;
    }
  }),
}));

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { deleteNotebook } from "@/lib/equipment-notebooks";

const TENANT = "00000000-0000-0000-0000-0000000000d1";
const NB = "11111111-2222-3333-4444-555555555555";

const sqlFor = (table: string) =>
  calls.find((c) => new RegExp(`DELETE FROM ${table}\\b`, "i").test(c.sql));

beforeEach(() => {
  calls.length = 0;
  ownedRows = [{ id: NB }];
  for (const k of Object.keys(deletedCounts)) delete deletedCounts[k];
  deletedCounts.equipment_notebooks = 1;
  failOnDelete = false;
});

describe("deleteNotebook — dependency cleanup", () => {
  it("deletes EVERY dependent table plus the parent (no orphans)", async () => {
    await deleteNotebook(TENANT, NB);
    for (const t of [
      "workspace_file_links",
      "equipment_notebook_turns",
      "equipment_notebook_sources",
      "equipment_notebooks",
    ]) {
      expect(sqlFor(t), `missing DELETE for ${t}`).toBeTruthy();
    }
  });

  it("deletes dependants BEFORE the parent row", async () => {
    await deleteNotebook(TENANT, NB);
    const order = calls
      .map((c) => /DELETE FROM (\w+)/i.exec(c.sql)?.[1])
      .filter(Boolean) as string[];
    expect(order.indexOf("equipment_notebooks")).toBe(order.length - 1);
  });

  it("scopes workspace_file_links by target_type — never deletes another target's links", async () => {
    await deleteNotebook(TENANT, NB);
    const sql = sqlFor("workspace_file_links")!.sql;
    expect(sql).toMatch(/target_type\s*=\s*'equipment_notebook'/i);
    expect(sql).toMatch(/target_id\s*=\s*\$2/);
  });

  it("never deletes the files themselves or the wrapped kg node", async () => {
    await deleteNotebook(TENANT, NB);
    const all = calls.map((c) => c.sql).join("\n");
    // One file may be linked to many notebooks (075) and the kg node outlives
    // the notebook; destroying either would be data loss beyond the request.
    expect(all).not.toMatch(/DELETE FROM namespace_direct_uploads/i);
    expect(all).not.toMatch(/DELETE FROM hub_uploads/i);
    expect(all).not.toMatch(/DELETE FROM knowledge_entries/i);
    expect(all).not.toMatch(/DELETE FROM kg_entities/i);
  });

  it("returns per-table counts so cleanup is observable to the caller", async () => {
    deletedCounts.equipment_notebook_sources = 3;
    deletedCounts.equipment_notebook_turns = 7;
    deletedCounts.workspace_file_links = 2;
    const res = await deleteNotebook(TENANT, NB);
    expect(res).toEqual({ deleted: true, sources: 3, turns: 7, fileLinks: 2 });
  });
});

describe("deleteNotebook — tenant isolation", () => {
  it("carries an explicit tenant predicate on EVERY statement", async () => {
    await deleteNotebook(TENANT, NB);
    for (const c of calls) {
      expect(c.sql, `no tenant predicate: ${c.sql}`).toMatch(/tenant_id\s*=\s*\$1/);
      expect(c.params[0]).toBe(TENANT);
    }
  });

  it("deletes NOTHING when the notebook is not owned by this tenant", async () => {
    ownedRows = []; // RLS + predicate make another tenant's row invisible
    const res = await deleteNotebook(TENANT, NB);
    expect(res).toEqual({ deleted: false, sources: 0, turns: 0, fileLinks: 0 });
    expect(calls.filter((c) => /DELETE FROM/i.test(c.sql))).toHaveLength(0);
  });

  it("locks the parent row FOR UPDATE so concurrent deletes cannot both report success", async () => {
    await deleteNotebook(TENANT, NB);
    expect(calls[0].sql).toMatch(/FOR UPDATE/i);
  });
});

describe("deleteNotebook — transactionality", () => {
  it("runs inside one transaction that commits on success", async () => {
    await deleteNotebook(TENANT, NB);
    expect(committed).toBe(true);
    expect(rolledBack).toBe(false);
  });

  it("rolls back — leaving the notebook intact — if any statement throws", async () => {
    // Drive the failure through the client (the real seam) rather than by
    // re-typing the withTenantContext mock: the helper's ROLLBACK-on-throw is
    // already modelled above, and this keeps the mock's signature honest.
    failOnDelete = true;
    await expect(deleteNotebook(TENANT, NB)).rejects.toThrow("deadlock");
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});
