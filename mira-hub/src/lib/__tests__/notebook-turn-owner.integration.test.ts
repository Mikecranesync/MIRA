/**
 * Turn ownership against REAL Postgres (migration 086 applied by
 * scripts/setup-integration-db.mjs). Proves, on the actual schema and RLS:
 *
 *   - a legacy row (owner_user_id IS NULL) is readable by every tenant user
 *     and labeled sharedLegacy
 *   - User A's new turn is invisible to User B on the SAME shared notebook
 *   - a turn cannot be written into a notebook of another tenant (atomic
 *     INSERT … SELECT against equipment_notebooks)
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… npm run db:integration:setup && npx vitest run --config vitest.integration.config.ts src/lib/__tests__/notebook-turn-owner
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USER_A = "user-a-integration";
const USER_B = "user-b-integration";

// vi.mock factories are hoisted above every import, so the pool the mock hands
// to `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));

import { listTurns, NotebookNotFoundError, recordTurn } from "../equipment-notebooks";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let nbA = "";
let nbB = "";

async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

run("equipment_notebook_turns.owner_user_id (integration)", () => {
  beforeAll(async () => {
    const a = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Shared conveyor', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT_A],
    );
    nbA = a.rows[0].id;
    const b = await q(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, 'Other tenant notebook', gen_random_uuid()) RETURNING id::text AS id`,
      [TENANT_B],
    );
    nbB = b.rows[0].id;
    // A pre-086 row: ownerless, shared history.
    await q(
      `INSERT INTO equipment_notebook_turns (notebook_id, tenant_id, question, answer_text) VALUES ($1::uuid, $2::uuid, 'legacy q', 'legacy a')`,
      [nbA, TENANT_A],
    );
  });

  afterAll(async () => {
    await q(`DELETE FROM equipment_notebook_turns WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT_A, TENANT_B]);
    await q(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT_A, TENANT_B]);
    await pool.end();
  });

  it("User A's new turn is private; legacy is shared and labeled; User B sees legacy only", async () => {
    await recordTurn(TENANT_A, nbA, {
      question: "A's private question",
      answerStatus: "answered",
      answerText: "A's answer",
      enabledSourceDocIds: [],
      evidence: [],
      model: null,
      ownerUserId: USER_A,
    });

    const seenByA = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_A });
    expect(seenByA.map((t) => [t.question, t.sharedLegacy])).toEqual([
      ["legacy q", true],
      ["A's private question", false],
    ]);

    const seenByB = await listTurns(TENANT_A, nbA, 50, { viewerUserId: USER_B });
    expect(seenByB.map((t) => t.question)).toEqual(["legacy q"]);
    expect(seenByB[0].sharedLegacy).toBe(true);

    // The legacy row was never silently assigned an owner.
    const legacy = await q(`SELECT owner_user_id FROM equipment_notebook_turns WHERE tenant_id = $1::uuid AND question = 'legacy q'`, [TENANT_A]);
    expect(legacy.rows[0].owner_user_id).toBeNull();
  });

  it("a turn cannot be written into another tenant's notebook", async () => {
    await expect(
      recordTurn(TENANT_A, nbB, {
        question: "cross-tenant write",
        answerStatus: "answered",
        answerText: "should not land",
        enabledSourceDocIds: [],
        evidence: [],
        model: null,
        ownerUserId: USER_A,
      }),
    ).rejects.toBeInstanceOf(NotebookNotFoundError);
    const landed = await q(`SELECT count(*)::int AS n FROM equipment_notebook_turns WHERE question = 'cross-tenant write'`);
    expect(landed.rows[0].n).toBe(0);
  });
});
