/**
 * listThreadsByNotebook against REAL Postgres: the integration schema
 * (migrations 073 → 089, applied by scripts/setup-integration-db.mjs), the real
 * withTenantContext (SET LOCAL ROLE factorylm_app + tenant settings + RLS), and
 * only the pool swapped for the disposable database.
 *
 * For every notebook it must return exactly what listThreads returns for that
 * notebook alone — same threads, order, owner rule, completed-only rows and
 * per-notebook limit — and never another tenant's rows, even when handed that
 * tenant's notebook id.
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE node scripts/setup-integration-db.mjs \
 *   && npx vitest run --config vitest.integration.config.ts tests/integration/list-threads-by-notebook
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = Boolean(process.env.TEST_DATABASE_URL) && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE";

// vi.mock factories are hoisted above every import, so the pool handed to
// `@/lib/db` must itself be created in a hoisted block.
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});
vi.mock("@/lib/db", () => ({ default: pool }));

import { listThreads, listThreadsByNotebook } from "@/lib/equipment-notebooks";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const VIEWER = "viewer-ltbn";
const OTHER_USER = "other-user-ltbn";
const nb: string[] = []; // TENANT's notebooks; nb[3] has no turns
let foreignNb = ""; // OTHER_TENANT's notebook

async function q(sql: string, values: unknown[] = []) {
  const c = await pool.connect();
  try {
    return await c.query(sql, values);
  } finally {
    c.release();
  }
}

async function notebook(tenant: string, name: string): Promise<string> {
  const r = await q(
    `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id) VALUES ($1::uuid, $2, gen_random_uuid()) RETURNING id::text AS id`,
    [tenant, name],
  );
  return r.rows[0].id;
}

async function turn(tenant: string, notebookId: string, thread: string | null, question: string, owner: string | null, state: "complete" | "pending", minutes: number) {
  await q(
    `INSERT INTO equipment_notebook_turns
       (notebook_id, tenant_id, thread_id, question, answer_text, owner_user_id, client_request_state, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'a', $5, $6, timestamptz '2026-10-01T00:00:00Z' + make_interval(mins => $7))`,
    [notebookId, tenant, thread, question, owner, state, minutes],
  );
}

describe.skipIf(!RUN)("listThreadsByNotebook (real Postgres, RLS)", () => {
  beforeAll(async () => {
    for (const name of ["ltbn-1", "ltbn-2", "ltbn-3", "ltbn-empty"]) nb.push(await notebook(TENANT, name));
    foreignNb = await notebook(OTHER_TENANT, "ltbn-foreign");
    // nb[0]: 4 viewer threads (2 turns each), one legacy turn (null thread,
    // null owner), one other user's thread (hidden), one pending turn (hidden).
    for (let t = 0; t < 4; t++) {
      await turn(TENANT, nb[0], `thrd_${t}`, `first question of thread ${t} with many words in it`, VIEWER, "complete", t * 10);
      await turn(TENANT, nb[0], `thrd_${t}`, `follow up ${t}`, VIEWER, "complete", t * 10 + 5);
    }
    await turn(TENANT, nb[0], null, "legacy turn", null, "complete", 7);
    await turn(TENANT, nb[0], "thrd_other", "someone else", OTHER_USER, "complete", 100);
    await turn(TENANT, nb[0], "thrd_pending", "in flight", VIEWER, "pending", 200);
    // nb[1]: legacy-only plus a thread mixing legacy and owned turns.
    await turn(TENANT, nb[1], null, "old legacy", null, "complete", 1);
    await turn(TENANT, nb[1], "thrd_mix", "mixed", null, "complete", 2);
    await turn(TENANT, nb[1], "thrd_mix", "mixed 2", VIEWER, "complete", 3);
    // nb[2]: one thread. The other tenant's notebook has a viewer-owned thread.
    await turn(TENANT, nb[2], "thrd_x", "only one", VIEWER, "complete", 50);
    await turn(OTHER_TENANT, foreignNb, "thrd_leak", "other tenant", VIEWER, "complete", 60);
  });

  afterAll(async () => {
    await q(`DELETE FROM equipment_notebook_turns WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER_TENANT]);
    await q(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT, OTHER_TENANT]);
    await pool.end();
  });

  for (const viewer of [VIEWER, null] as const) {
    for (const limit of [20, 2]) {
      it(`matches listThreads per notebook (viewer=${viewer ?? "none"}, limit=${limit})`, async () => {
        const batched = await listThreadsByNotebook(TENANT, nb, limit, { viewerUserId: viewer });
        for (const id of nb) {
          const single = await listThreads(TENANT, id, limit, { viewerUserId: viewer });
          expect(batched.get(id) ?? [], id).toEqual(single);
        }
      });
    }
  }

  it("orders by latest turn, keeps legacy, hides other owners and pending turns, and applies the limit per notebook", async () => {
    const full = await listThreadsByNotebook(TENANT, nb, 20, { viewerUserId: VIEWER });
    expect(full.get(nb[0])?.map((t) => t.id)).toEqual(["thrd_3", "thrd_2", "thrd_1", "legacy", "thrd_0"]);
    expect(full.get(nb[0])?.map((t) => t.turnCount)).toEqual([2, 2, 2, 1, 2]);
    expect(full.get(nb[1])?.map((t) => [t.id, t.sharedLegacy])).toEqual([["thrd_mix", true], ["legacy", true]]);
    expect(full.get(nb[2])?.map((t) => t.id)).toEqual(["thrd_x"]);
    expect(full.has(nb[3])).toBe(false);
    const capped = await listThreadsByNotebook(TENANT, nb, 2, { viewerUserId: VIEWER });
    expect(capped.get(nb[0])?.map((t) => t.id)).toEqual(["thrd_3", "thrd_2"]);
    expect(capped.get(nb[1])?.map((t) => t.id)).toEqual(["thrd_mix", "legacy"]);
  });

  it("never returns another tenant's threads, even when given that tenant's notebook id", async () => {
    // Precondition: the foreign rows exist and are visible to their own tenant.
    expect((await listThreads(OTHER_TENANT, foreignNb, 20, { viewerUserId: VIEWER })).map((t) => t.id)).toEqual(["thrd_leak"]);
    const out = await listThreadsByNotebook(TENANT, [...nb, foreignNb], 20, { viewerUserId: VIEWER });
    expect(out.has(foreignNb)).toBe(false);
    expect([...out.values()].flat().map((t) => t.id)).not.toContain("thrd_leak");
  });

  it("runs no query for an empty notebook list", async () => {
    const spy = vi.spyOn(pool, "connect");
    expect((await listThreadsByNotebook(TENANT, [], 20)).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
