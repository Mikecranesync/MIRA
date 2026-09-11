/**
 * Turn ownership at the lib seam — the ONE read path (listTurns) and the ONE
 * write path (recordTurn) for equipment_notebook_turns.
 *
 * Run: cd mira-hub && npx vitest run src/lib/__tests__/notebook-turn-owner
 *
 *  - recordTurn writes owner_user_id from the value the ROUTE derived from the
 *    session, and the INSERT is atomic with tenant ownership of the notebook:
 *    it selects FROM equipment_notebooks WHERE id AND tenant_id, so a foreign
 *    notebook id inserts zero rows and the call fails closed.
 *  - listTurns returns the viewer's own turns plus ownerless LEGACY turns,
 *    each labeled; never another user's owned turns. Without a viewer it
 *    returns legacy rows only (fail closed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => tenantMock);
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { listThreads, listTurns, NotebookNotFoundError, recordTurn } from "../equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const USER_A = "user-a";
const USER_B = "user-b";

type Call = { sql: string; values: unknown[] };

function wire(turnRows: unknown[], opts: { insertRowCount?: number } = {}) {
  const calls: Call[] = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (/INSERT INTO equipment_notebook_turns/.test(sql)) {
        const n = opts.insertRowCount ?? 1;
        return { rows: n ? [{ id: "new-turn" }] : [], rowCount: n };
      }
      if (/FROM equipment_notebook_turns/.test(sql)) return { rows: turnRows, rowCount: turnRows.length };
      return { rows: [], rowCount: 0 };
    }),
  };
  tenantMock.withTenantContext.mockImplementation(async (_t: string, fn: (c: unknown) => unknown) => fn(client));
  return calls;
}

const baseTurn = {
  question: "q",
  answerStatus: "answered" as const,
  answerText: "a",
  enabledSourceDocIds: [] as string[],
  evidence: [] as unknown[],
  model: null,
};

beforeEach(() => vi.clearAllMocks());

describe("recordTurn — owner from the session, atomic tenant ownership", () => {
  it("persists owner_user_id and inserts THROUGH the notebook's tenant row", async () => {
    const calls = wire([]);
    await recordTurn(TENANT, NB, { ...baseTurn, ownerUserId: USER_A });
    const ins = calls.find((c) => /INSERT INTO equipment_notebook_turns/.test(c.sql));
    expect(ins, "an INSERT was issued").toBeTruthy();
    expect(ins!.sql).toMatch(/owner_user_id/);
    expect(ins!.sql).toMatch(/thread_id/);
    // Atomic with ownership: the row set comes FROM equipment_notebooks scoped
    // to (id, tenant_id) — not a bare VALUES list.
    expect(ins!.sql).toMatch(/FROM\s+equipment_notebooks/i);
    expect(ins!.sql).toMatch(/tenant_id\s*=\s*\$\d+::uuid/);
    expect(ins!.values).toContain(USER_A);
  });

  it("persists a caller-selected thread id without trusting it for tenant ownership", async () => {
    const calls = wire([]);
    await recordTurn(TENANT, NB, { ...baseTurn, ownerUserId: USER_A, threadId: "thrd_a" });
    const ins = calls.find((c) => /INSERT INTO equipment_notebook_turns/.test(c.sql))!;
    expect(ins.sql).toMatch(/FROM\s+equipment_notebooks/i);
    expect(ins.values).toContain("thrd_a");
  });

  it("fails closed when the notebook is not this tenant's (zero rows inserted)", async () => {
    wire([], { insertRowCount: 0 });
    await expect(recordTurn(TENANT, NB, { ...baseTurn, ownerUserId: USER_A })).rejects.toBeInstanceOf(NotebookNotFoundError);
  });
});

describe("listTurns — own turns + labeled legacy, never another user's", () => {
  const rows = [
    { id: "t-legacy", thread_id: null, question: "old", answer_status: "answered", answer_text: "x", evidence: [], basis: null, created_at: "2026-08-01T00:00:00Z", owner_user_id: null },
    { id: "t-a", thread_id: "thrd_a", question: "mine", answer_status: "answered", answer_text: "y", evidence: [], basis: null, created_at: "2026-09-01T00:00:00Z", owner_user_id: USER_A },
  ];

  it("filters by viewer OR ownerless in SQL, and labels each row", async () => {
    const calls = wire(rows);
    const out = await listTurns(TENANT, NB, 50, { viewerUserId: USER_A });
    const sel = calls.find((c) => /FROM equipment_notebook_turns/.test(c.sql))!;
    expect(sel.sql).toMatch(/owner_user_id\s*=\s*\$\d+/);
    expect(sel.sql).toMatch(/owner_user_id\s+IS\s+NULL/i);
    expect(sel.values).toContain(USER_A);
    expect(out.map((t) => [t.id, t.threadId, t.ownerUserId, t.sharedLegacy])).toEqual([
      ["t-legacy", "legacy", null, true],
      ["t-a", "thrd_a", USER_A, false],
    ]);
  });

  it("can filter one non-legacy thread inside the viewer's notebook history", async () => {
    const calls = wire([rows[1]]);
    const out = await listTurns(TENANT, NB, 50, { viewerUserId: USER_A, threadId: "thrd_a" });
    const sel = calls.find((c) => /FROM equipment_notebook_turns/.test(c.sql))!;
    expect(sel.sql).toMatch(/thread_id\s*=\s*\$\d+/);
    expect(sel.values).toContain("thrd_a");
    expect(out.map((t) => t.threadId)).toEqual(["thrd_a"]);
  });

  it("can filter the legacy/default thread without matching a named thread", async () => {
    const calls = wire([rows[0]]);
    const out = await listTurns(TENANT, NB, 50, { viewerUserId: USER_A, threadId: "legacy" });
    const sel = calls.find((c) => /FROM equipment_notebook_turns/.test(c.sql))!;
    expect(sel.sql).toMatch(/thread_id\s+IS\s+NULL/i);
    expect(sel.values).not.toContain("legacy");
    expect(out.map((t) => t.threadId)).toEqual(["legacy"]);
  });

  it("without a viewer, only ownerless legacy rows are requested (fail closed)", async () => {
    const calls = wire([rows[0]]);
    const out = await listTurns(TENANT, NB, 50);
    const sel = calls.find((c) => /FROM equipment_notebook_turns/.test(c.sql))!;
    expect(sel.sql).toMatch(/owner_user_id\s+IS\s+NULL/i);
    expect(sel.values).not.toContain(USER_A);
    expect(sel.values).not.toContain(USER_B);
    expect(out).toHaveLength(1);
    expect(out[0].sharedLegacy).toBe(true);
  });
});

describe("listThreads — notebook as Project, turns as conversations", () => {
  it("derives recent thread summaries from only the viewer-visible rows", async () => {
    const calls = wire([
      { thread_id: "thrd_b", first_question: "Second thread question with many extra words here", created_at: "2026-09-02T00:00:00Z", updated_at: "2026-09-02T00:05:00Z", turn_count: 2, shared_legacy: false },
      { thread_id: null, first_question: "Legacy question", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:05:00Z", turn_count: 1, shared_legacy: true },
    ]);
    const out = await listThreads(TENANT, NB, 50, { viewerUserId: USER_A });
    const sel = calls.find((c) => /GROUP BY thread_id/.test(c.sql))!;
    expect(sel.sql).toMatch(/owner_user_id\s*=\s*\$\d+/);
    expect(sel.sql).toMatch(/owner_user_id\s+IS\s+NULL/i);
    expect(out.map((t) => [t.id, t.title, t.turnCount, t.sharedLegacy])).toEqual([
      ["thrd_b", "Second thread question with many extra words here", 2, false],
      ["legacy", "Legacy question", 1, true],
    ]);
  });
});
