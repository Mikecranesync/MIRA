/**
 * Thread identity against REAL Postgres (migration 087 applied by
 * scripts/setup-integration-db.mjs). Proves the server half of parity
 * contract Gap 1 (docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md
 * §5, "New Chat and thread identity") on the actual schema and constraint:
 *
 *   - a New Chat turn persists its client-generated thread id verbatim
 *   - reading that thread returns ONLY its own turns — an older, busy
 *     legacy conversation on the same notebook never leaks in
 *   - the new thread appears in the notebook's thread list (history entry)
 *     with a title derived from its first question
 *   - re-reading the exact thread id restores the conversation intact
 *     (the "navigate away → reopen the exact thread row" step)
 *   - the legacy/default conversation is likewise isolated from new threads
 *   - a second New Chat mints a second independent thread
 *   - 087's CHECK constraint rejects a malformed thread id at the database,
 *     not just in route validation
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE \
 *   npm run db:integration:setup && npx vitest run \
 *   --config vitest.integration.config.ts tests/integration/notebook-thread-identity
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT = "cccccccc-0000-4000-8000-00000000000c";
const USER_A = "user-a-thread-integration";
const USER_B = "user-b-thread-integration";
const THREAD_NEW = "thrd_gap1proof0001";
const THREAD_SECOND = "thrd_gap1proof0002";

// vi.mock factories are hoisted above every import, so the pool the mock hands
// to `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));

import { LEGACY_THREAD_ID, listThreads, listTurns, recordTurn } from "@/lib/equipment-notebooks";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let nb = "";

async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

function turn(question: string, threadId?: string | null) {
  return {
    question,
    answerStatus: "answered" as const,
    answerText: `answer: ${question}`,
    enabledSourceDocIds: [],
    evidence: [],
    model: null,
    ownerUserId: USER_A,
    ...(threadId === undefined ? {} : { threadId }),
  };
}

run("equipment_notebook_turns.thread_id (integration, Gap 1)", () => {
  beforeAll(async () => {
    const r = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Gap 1 conveyor', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT],
    );
    nb = r.rows[0].id;
    // A busy pre-existing default conversation: the "old notebook history"
    // that must never leak into a New Chat. Mixed ownerless legacy rows and
    // viewer-owned rows, all in the pre-087 NULL thread.
    // Distinct created_at per row: a single multi-row INSERT shares one
    // now(), which makes chronological assertions nondeterministic.
    await q(
      `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_text, created_at) VALUES ($1::uuid, $2::uuid, 'old shared q1', 'a1', now() - interval '2 minutes'), ($1::uuid, $2::uuid, 'old shared q2', 'a2', now() - interval '1 minute')`,
      [nb, TENANT],
    );
    for (const question of ["old mine q3", "old mine q4", "old mine q5"]) {
      await recordTurn(TENANT, nb, turn(question));
    }
  });

  afterAll(async () => {
    await q(`DELETE FROM equipment_notebook_turns WHERE tenant_id = $1::uuid`, [TENANT]);
    await q(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
    await pool.end();
  });

  it("New Chat: first send creates a distinct server thread whose read returns only its own turn", async () => {
    await recordTurn(TENANT, nb, turn("Why is the VFD tripping F0004?", THREAD_NEW));

    // Distinct server identity: the row carries the client-generated id verbatim.
    const stored = await q(
      `SELECT thread_id FROM equipment_notebook_turns WHERE tenant_id = $1::uuid AND question = 'Why is the VFD tripping F0004?'`,
      [TENANT],
    );
    expect(stored.rows[0].thread_id).toBe(THREAD_NEW);

    // Isolation: only the new conversation's turns appear — none of the five
    // older default-thread turns leak into the new chat.
    const fresh = await listTurns(TENANT, nb, 50, { viewerUserId: USER_A, threadId: THREAD_NEW });
    expect(fresh.map((t) => [t.question, t.threadId])).toEqual([
      ["Why is the VFD tripping F0004?", THREAD_NEW],
    ]);
  });

  it("the new thread appears in the notebook's history with a title from its first question", async () => {
    const threads = await listThreads(TENANT, nb, 50, { viewerUserId: USER_A });
    const ids = threads.map((t) => t.id);
    expect(ids).toContain(THREAD_NEW);
    expect(ids).toContain(LEGACY_THREAD_ID);
    const fresh = threads.find((t) => t.id === THREAD_NEW)!;
    expect(fresh.turnCount).toBe(1);
    expect(fresh.title).toBe("Why is the VFD tripping F0004?");
    // Newest activity first: the just-created thread precedes the old one.
    expect(ids.indexOf(THREAD_NEW)).toBeLessThan(ids.indexOf(LEGACY_THREAD_ID));
  });

  it("reopening the exact thread restores the conversation intact, and the legacy thread stays isolated", async () => {
    // "Navigate away and come back": a fresh read of the exact thread id.
    const reopened = await listTurns(TENANT, nb, 50, { viewerUserId: USER_A, threadId: THREAD_NEW });
    expect(reopened).toHaveLength(1);
    expect(reopened[0].question).toBe("Why is the VFD tripping F0004?");
    expect(reopened[0].answerText).toBe("answer: Why is the VFD tripping F0004?");

    // The default conversation shows its five old turns and nothing from the
    // new thread — isolation holds in both directions.
    const legacy = await listTurns(TENANT, nb, 50, { viewerUserId: USER_A, threadId: LEGACY_THREAD_ID });
    expect(legacy.map((t) => t.question)).toEqual([
      "old shared q1",
      "old shared q2",
      "old mine q3",
      "old mine q4",
      "old mine q5",
    ]);
    expect(legacy.every((t) => t.threadId === LEGACY_THREAD_ID)).toBe(true);
  });

  it("a second New Chat mints a second independent thread", async () => {
    await recordTurn(TENANT, nb, turn("Startup checklist for the mixer?", THREAD_SECOND));

    const second = await listTurns(TENANT, nb, 50, { viewerUserId: USER_A, threadId: THREAD_SECOND });
    expect(second.map((t) => t.question)).toEqual(["Startup checklist for the mixer?"]);

    const first = await listTurns(TENANT, nb, 50, { viewerUserId: USER_A, threadId: THREAD_NEW });
    expect(first.map((t) => t.question)).toEqual(["Why is the VFD tripping F0004?"]);

    const threads = await listThreads(TENANT, nb, 50, { viewerUserId: USER_A });
    expect(threads.map((t) => t.id).sort()).toEqual([LEGACY_THREAD_ID, THREAD_NEW, THREAD_SECOND].sort());
  });

  it("another technician's thread list never shows my private threads", async () => {
    const threads = await listThreads(TENANT, nb, 50, { viewerUserId: USER_B });
    // USER_B sees only the shared legacy conversation (its ownerless rows).
    expect(threads.map((t) => t.id)).toEqual([LEGACY_THREAD_ID]);
  });

  it("087's CHECK constraint rejects a malformed thread id at the database", async () => {
    await expect(
      q(
        `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_text, thread_id) VALUES ($1::uuid, $2::uuid, 'bad thread', 'x', $3)`,
        [nb, TENANT, "-starts-with-dash"],
      ),
    ).rejects.toMatchObject({ constraint: "equipment_notebook_turns_thread_id_shape" });
  });
});
