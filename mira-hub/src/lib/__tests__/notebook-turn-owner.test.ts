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

import {
  abandonNotebookTurnRequest,
  claimNotebookTurnRequest,
  listThreads,
  listTurns,
  NotebookNotFoundError,
  recordTurn,
} from "../equipment-notebooks";

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

describe("claimNotebookTurnRequest — atomic execution ownership and replay", () => {
  function wireClaim(rows: unknown[]) {
    const calls: Call[] = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return { rows, rowCount: rows.length };
      }),
    };
    tenantMock.withTenantContext.mockImplementation(async (_t: string, fn: (c: unknown) => unknown) => fn(client));
    return calls;
  }

  it("atomically inserts a hidden pending claim scoped to tenant, notebook, and owner", async () => {
    const calls = wireClaim([{ claim_status: "claimed", claim_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]);
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await expect(
      claimNotebookTurnRequest(TENANT, NB, {
        ownerUserId: USER_A,
        clientRequestId,
        question: "q",
        threadId: "thrd_a",
      }),
    ).resolves.toEqual({ status: "claimed", claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });

    expect(calls[0].sql).toMatch(/INSERT INTO equipment_notebook_turns/i);
    expect(calls[0].sql).toMatch(/client_request_state/i);
    expect(calls[0].sql).toMatch(/'pending'/i);
    expect(calls[0].sql).toMatch(/ON CONFLICT[\s\S]+client_request_id[\s\S]+DO UPDATE/i);
    expect(calls[0].sql).toMatch(/candidate\.token/i);
    expect(calls[0].sql).toMatch(/client_request_payload IS NULL[\s\S]+THEN 'mismatch'/i);
    expect(calls[0].sql).not.toMatch(/client_request_payload IS NULL OR/i);
    expect(calls[0].sql).toMatch(/FROM\s+equipment_notebooks/i);
    expect(calls[0].values).toEqual(expect.arrayContaining([NB, TENANT, USER_A, clientRequestId, "q", "thrd_a"]));
  });

  it("returns the first completed terminal turn for replay", async () => {
    wireClaim([{
      claim_status: "replay",
      id: "turn-1",
      question: "q",
      answer_status: "answered",
      answer_text: "SAFETY STOP",
      enabled_source_doc_ids: [],
      evidence: [{ kind: "safety_notice", trigger: "smoke" }],
      model: null,
      basis: null,
    }]);

    const out = await claimNotebookTurnRequest(TENANT, NB, {
      ownerUserId: USER_A,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      question: "q",
      threadId: null,
    });

    expect(out).toEqual({
      status: "replay",
      turn: expect.objectContaining({
        id: "turn-1",
        answerStatus: "answered",
        answerText: "SAFETY STOP",
        evidence: [{ kind: "safety_notice", trigger: "smoke" }],
      }),
    });
  });

  it("does not let a concurrent caller or a changed payload own the same key", async () => {
    wireClaim([{ claim_status: "in_progress" }]);
    await expect(
      claimNotebookTurnRequest(TENANT, NB, {
        ownerUserId: USER_A,
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        question: "q",
        threadId: null,
      }),
    ).resolves.toEqual({ status: "in_progress" });

    wireClaim([{ claim_status: "mismatch" }]);
    await expect(
      claimNotebookTurnRequest(TENANT, NB, {
        ownerUserId: USER_A,
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        question: "different question",
        threadId: null,
      }),
    ).resolves.toEqual({ status: "mismatch" });
  });

  it("abandons only the caller's current lease token", async () => {
    const calls = wireClaim([]);
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const claimToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await abandonNotebookTurnRequest(TENANT, NB, USER_A, clientRequestId, claimToken);

    expect(calls[0].sql).toMatch(/client_request_claim_token\s*=\s*\$5::uuid/i);
    expect(calls[0].values).toEqual([TENANT, NB, USER_A, clientRequestId, claimToken]);
  });
});

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

  it("deduplicates a client request id inside the authenticated owner/notebook scope", async () => {
    const calls = wire([]);
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await recordTurn(TENANT, NB, { ...baseTurn, ownerUserId: USER_A, clientRequestId });
    const ins = calls.find((c) => /INSERT INTO equipment_notebook_turns/.test(c.sql))!;
    expect(ins.sql).toMatch(/client_request_id/);
    expect(ins.sql).toMatch(/ON CONFLICT[\s\S]+client_request_id[\s\S]+DO NOTHING/i);
    expect(ins.sql).toMatch(/client_request_claim_token\s*=\s*\$\d+::uuid/i);
    expect(ins.values).toContain(clientRequestId);
  });

  it("never lets a leased writer accept another worker's completed row", async () => {
    const calls = wire([]);
    await recordTurn(TENANT, NB, {
      ...baseTurn,
      ownerUserId: USER_A,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const ins = calls.find((c) => /INSERT INTO equipment_notebook_turns/.test(c.sql))!;

    expect(ins.sql).toMatch(
      /t\.client_request_state\s*=\s*'complete'[\s\S]+\$15::uuid\s+IS\s+NULL/i,
    );
    expect(ins.sql).toMatch(
      /completed_claim AS \([\s\S]+UPDATE equipment_notebook_turns t[\s\S]+WHERE \$15::uuid IS NOT NULL[\s\S]+t\.client_request_claim_token = \$15::uuid[\s\S]+RETURNING t\.id/i,
    );
    expect(ins.sql).toMatch(
      /inserted AS \([\s\S]+INSERT INTO equipment_notebook_turns[\s\S]+FROM owned_notebook nb[\s\S]+WHERE \$15::uuid IS NULL[\s\S]+ON CONFLICT[\s\S]+DO NOTHING/i,
    );
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
