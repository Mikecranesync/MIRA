/**
 * Equipment Notebook domain — SQL/validation contracts (PRD §8, §20, §29.1-2).
 *
 * Run: npx vitest run src/lib/__tests__/equipment-notebooks-domain.test.ts
 *
 * Asserts the SQL contracts, not just return values:
 *  - createNotebook pins the backing node approval_state='verified' (a node
 *    without the pin makes chat 404 — audit trap);
 *  - attachSource validates hub_uploads ownership on the RAW pool with an
 *    explicit tenant predicate BEFORE any notebook write (IDOR);
 *  - validateChatSources refuses non-UUID ids, foreign ids, and rejected
 *    sources; only membership rows of THIS notebook+tenant pass;
 *  - candidate sources attach DISABLED by default (PRD §7.1 safety rule).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { sql: string; params: unknown[] };
const calls: Call[] = [];
const rowsByMatch: Array<{ re: RegExp; rows: Record<string, unknown>[] }> = [];

function client() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const hit = rowsByMatch.find((m) => m.re.test(sql));
      return { rows: hit ? hit.rows : [], rowCount: hit ? hit.rows.length : 0 };
    }),
  };
}

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(client())),
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: `POOL:${sql}`, params });
    return { rows: [] as Record<string, unknown>[] };
  }),
}));
vi.mock("@/lib/db", () => ({ default: poolMock }));

import { attachSource, createNotebook, validateChatSources } from "../equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const DOC2 = "44444444-4444-4444-8444-444444444444";
const DOC3 = "55555555-5555-4555-8555-555555555555";

function callFor(re: RegExp): Call | undefined {
  return calls.find((c) => re.test(c.sql));
}

beforeEach(() => {
  calls.length = 0;
  rowsByMatch.length = 0;
  vi.clearAllMocks();
});

describe("createNotebook", () => {
  it("pins the backing node approval_state='verified' and stores node_id", async () => {
    rowsByMatch.push(
      { re: /INSERT INTO kg_entities/, rows: [{ id: "node-1" }] },
      { re: /INSERT INTO equipment_notebooks/, rows: [{ id: NB, display_name: "Conveyor 4", node_id: "node-1", identity_status: "unknown", created_at: "now" }] },
    );
    const nb = await createNotebook(TENANT, { displayName: "Conveyor 4" });
    const nodeInsert = callFor(/INSERT INTO kg_entities/);
    expect(nodeInsert?.sql).toContain("'verified'");
    expect(nodeInsert?.sql).toContain("'equipment'");
    expect(nb.nodeId).toBe("node-1");
  });

  it("uses an UN-aliased RETURNING clause (a RETURNING has no table alias — live 500 regression)", async () => {
    rowsByMatch.push(
      { re: /INSERT INTO kg_entities/, rows: [{ id: "node-1" }] },
      { re: /INSERT INTO equipment_notebooks/, rows: [{ id: NB, display_name: "X", node_id: "node-1", identity_status: "unknown", created_at: "now" }] },
    );
    await createNotebook(TENANT, { displayName: "X" });
    const ins = callFor(/INSERT INTO equipment_notebooks/);
    const returning = ins!.sql.slice(ins!.sql.indexOf("RETURNING"));
    expect(returning).not.toMatch(/n\./); // no `n.`-prefixed columns in RETURNING
    expect(returning).toContain("display_name");
  });

  it("rejects an empty display name", async () => {
    await expect(createNotebook(TENANT, { displayName: "  " })).rejects.toThrow(
      "display_name_required",
    );
  });
});

describe("attachSource IDOR guard", () => {
  it("checks hub_uploads ownership on the raw pool BEFORE any notebook write", async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [] }); // doc not owned by tenant
    const res = await attachSource(TENANT, NB, DOC);
    expect(res).toEqual({ ok: false, error: "doc_not_found" });
    const [ownSql, ownParams] = poolMock.query.mock.calls[0] as [string, unknown[]];
    expect(ownSql).toContain("FROM hub_uploads");
    expect(ownSql).toContain("tenant_id = $1");
    expect(ownParams).toEqual([TENANT, DOC]);
    // No membership INSERT happened
    expect(callFor(/INSERT INTO equipment_notebook_sources/)).toBeUndefined();
  });

  it("attaches a candidate source DISABLED by default (PRD 7.1)", async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ id: DOC }] });
    rowsByMatch.push(
      { re: /SELECT id FROM equipment_notebooks/, rows: [{ id: NB }] },
      { re: /INSERT INTO equipment_notebook_sources/, rows: [{}] },
    );
    const res = await attachSource(TENANT, NB, DOC, { matchState: "candidate" });
    expect(res.ok).toBe(true);
    const ins = callFor(/INSERT INTO equipment_notebook_sources/);
    // params: [notebookId, docId, tenantId, enabledByDefault, matchState, ...]
    expect(ins?.params?.[3]).toBe(false);
    expect(ins?.params?.[4]).toBe("candidate");
  });

  it("a system candidate re-suggestion can never override a human decision (SQL contract)", async () => {
    poolMock.query.mockResolvedValueOnce({ rows: [{ id: DOC }] });
    rowsByMatch.push(
      { re: /SELECT id FROM equipment_notebooks/, rows: [{ id: NB }] },
      { re: /INSERT INTO equipment_notebook_sources/, rows: [{}] },
    );
    await attachSource(TENANT, NB, DOC, { matchState: "candidate" });
    const ins = callFor(/INSERT INTO equipment_notebook_sources/);
    const sql = ins!.sql;
    // An incoming 'candidate' over a human-ruled row keeps the HUMAN's state
    // (a rejected row stays rejected — the system cannot resurrect it) ...
    expect(sql).toMatch(
      /match_state IN \('user_confirmed', 'rejected'\)[\s\S]*?EXCLUDED\.match_state = 'candidate'[\s\S]*?THEN equipment_notebook_sources\.match_state/,
    );
    // ... and keeps the HUMAN's enable/disable toggle (the system cannot
    // re-enable a source the user explicitly disabled).
    expect(sql).toContain("THEN equipment_notebook_sources.enabled_by_default");
  });
});

describe("validateChatSources", () => {
  it("refuses non-UUID injections before touching the database", async () => {
    const res = await validateChatSources(TENANT, NB, ["1 OR 1=1", DOC]);
    expect(res).toEqual({ ok: false, error: "invalid_source_id" });
    expect(calls.length).toBe(0);
  });

  it("refuses an id that is not a member of this notebook (sibling isolation)", async () => {
    rowsByMatch.push(
      { re: /FROM equipment_notebooks/, rows: [{ node_id: "n1" }] },
      { re: /FROM equipment_notebook_sources/, rows: [] }, // membership query: no rows
    );
    const res = await validateChatSources(TENANT, NB, [DOC]);
    expect(res).toEqual({ ok: false, error: "source_not_in_notebook" });
    const membership = callFor(/FROM equipment_notebook_sources/);
    // Positive trust required (Codex P1, 2026-08-16): candidates and disabled
    // sources are excluded, not merely rejected ones.
    expect(membership?.sql).toContain("match_state IN ('user_confirmed', 'verified')");
    expect(membership?.sql).toContain("enabled_by_default = true");
    expect(membership?.sql).toContain("notebook_id = $2");
  });

  it("passes only when every requested id is a live member", async () => {
    rowsByMatch.push(
      { re: /FROM equipment_notebooks/, rows: [{ node_id: "n1" }] },
      { re: /FROM equipment_notebook_sources/, rows: [{ doc_id: DOC }] },
    );
    const res = await validateChatSources(TENANT, NB, [DOC]);
    expect(res).toEqual({ ok: true, docIds: [DOC], nodeId: "n1" });
  });

  // #3442: a nameplate re-confirm supersedes the derived doc while the client's
  // composer still holds the OLD doc id. The technician's intent ("use my
  // nameplate") is unambiguous — map the stale id to its visible successor for
  // the same (notebook, origin photo) instead of a mislabeled 403.
  it("remaps a superseded doc id to its visible successor for the same origin photo (#3442)", async () => {
    rowsByMatch.push(
      { re: /FROM equipment_notebooks/, rows: [{ node_id: "n1" }] },
      // Successor lookup (self-join) — must be listed BEFORE the plain
      // membership matcher because its SQL also contains the FROM clause.
      { re: /JOIN equipment_notebook_sources/, rows: [{ old_doc_id: DOC, new_doc_id: DOC2 }] },
      { re: /FROM equipment_notebook_sources/, rows: [] }, // membership: stale id not visible
    );
    const res = await validateChatSources(TENANT, NB, [DOC]);
    expect(res).toEqual({
      ok: true,
      docIds: [DOC2],
      nodeId: "n1",
      remapped: { [DOC]: DOC2 },
    });
    const remap = callFor(/JOIN equipment_notebook_sources/);
    // The stale row must be PROVEN superseded in this tenant+notebook, and the
    // successor must clear the same positive-trust bar as a direct member —
    // remapping must not become a side door around the positive-trust rule.
    expect(remap?.sql).toContain("superseded_at IS NOT NULL");
    expect(remap?.sql).toContain("match_state IN ('user_confirmed', 'verified')");
    expect(remap?.sql).toContain("enabled_by_default = true");
    expect(remap?.params?.[2]).toEqual([DOC]);
  });

  it("keeps directly-valid ids and remaps only the stale ones", async () => {
    rowsByMatch.push(
      { re: /FROM equipment_notebooks/, rows: [{ node_id: "n1" }] },
      { re: /JOIN equipment_notebook_sources/, rows: [{ old_doc_id: DOC2, new_doc_id: DOC3 }] },
      { re: /FROM equipment_notebook_sources/, rows: [{ doc_id: DOC }] },
    );
    const res = await validateChatSources(TENANT, NB, [DOC, DOC2]);
    expect(res).toEqual({
      ok: true,
      docIds: [DOC, DOC3],
      nodeId: "n1",
      remapped: { [DOC2]: DOC3 },
    });
  });

  it("still refuses a stale id with no visible successor (no side door)", async () => {
    rowsByMatch.push(
      { re: /FROM equipment_notebooks/, rows: [{ node_id: "n1" }] },
      { re: /JOIN equipment_notebook_sources/, rows: [] }, // no successor
      { re: /FROM equipment_notebook_sources/, rows: [] },
    );
    const res = await validateChatSources(TENANT, NB, [DOC]);
    expect(res).toEqual({ ok: false, error: "source_not_in_notebook" });
  });
});
