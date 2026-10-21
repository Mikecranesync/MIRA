// Requires a disposable Postgres (any empty database works; the test creates
// and drops its own schema).
//
//   TEST_DATABASE_URL=postgres://... MIRA_TEST_DB_CONFIRM=DISPOSABLE \
//     npx vitest run --config vitest.integration.config.ts src/lib/__tests__/list-threads-by-notebook
//
// listThreadsByNotebook must return, for every notebook, exactly what
// listThreads returns for that notebook alone: same threads, same order, same
// owner rule, same per-notebook limit. Real SQL, because the window function
// and the ANY(uuid[]) predicate are the whole change.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

const RUN = process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE";
const SCHEMA = `ltbn_${process.pid}`;

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: PoolClient) => unknown) => {
    const client = await testPool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      return await fn(client);
    } finally {
      client.release();
    }
  },
}));

import { listThreads, listThreadsByNotebook } from "../equipment-notebooks";

const TENANT = "0000aaaa-0000-4000-8000-00000000aaaa";
const OTHER_TENANT = "0000bbbb-0000-4000-8000-00000000bbbb";
const NB = [
  "00000001-0000-4000-8000-000000000001",
  "00000002-0000-4000-8000-000000000002",
  "00000003-0000-4000-8000-000000000003",
  "00000004-0000-4000-8000-000000000004", // no turns at all
];

describe.skipIf(!RUN)("listThreadsByNotebook (real Postgres)", () => {
  beforeAll(async () => {
    await testPool.query(`CREATE SCHEMA ${SCHEMA}`);
    await testPool.query(`
      CREATE TABLE ${SCHEMA}.equipment_notebook_turns (
        tenant_id UUID NOT NULL,
        notebook_id UUID NOT NULL,
        thread_id TEXT NULL,
        question TEXT NOT NULL,
        owner_user_id TEXT NULL,
        client_request_state TEXT NOT NULL DEFAULT 'complete',
        created_at TIMESTAMPTZ NOT NULL
      )`);
    const rows: [string, string, string | null, string, string | null, string, number][] = [];
    // nb1: 4 threads owned by viewer, one legacy (null thread, null owner),
    // one by another user (hidden), one pending turn (hidden).
    for (let t = 0; t < 4; t++) {
      rows.push([TENANT, NB[0], `thrd_${t}`, `first question of thread ${t} with many words in it`, "viewer", "complete", t * 10]);
      rows.push([TENANT, NB[0], `thrd_${t}`, `follow up ${t}`, "viewer", "complete", t * 10 + 5]);
    }
    rows.push([TENANT, NB[0], null, "legacy turn", null, "complete", 7]);
    rows.push([TENANT, NB[0], "thrd_other", "someone else", "other-user", "complete", 100]);
    rows.push([TENANT, NB[0], "thrd_pending", "in flight", "viewer", "pending", 200]);
    // nb2: legacy-only plus a mixed thread; nb3: one thread; another tenant's
    // row on nb3's id must never show.
    rows.push([TENANT, NB[1], null, "old legacy", null, "complete", 1]);
    rows.push([TENANT, NB[1], "thrd_mix", "mixed", null, "complete", 2]);
    rows.push([TENANT, NB[1], "thrd_mix", "mixed 2", "viewer", "complete", 3]);
    rows.push([TENANT, NB[2], "thrd_x", "only one", "viewer", "complete", 50]);
    rows.push([OTHER_TENANT, NB[2], "thrd_leak", "other tenant", "viewer", "complete", 60]);
    for (const [tenant, nb, thread, q, owner, state, minutes] of rows) {
      await testPool.query(
        `INSERT INTO ${SCHEMA}.equipment_notebook_turns
           (tenant_id, notebook_id, thread_id, question, owner_user_id, client_request_state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, timestamptz '2026-10-01T00:00:00Z' + make_interval(mins => $7))`,
        [tenant, nb, thread, q, owner, state, minutes],
      );
    }
  });

  afterAll(async () => {
    await testPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await testPool.end();
  });

  for (const viewer of ["viewer", null] as const) {
    for (const limit of [20, 2]) {
      it(`matches listThreads per notebook (viewer=${viewer ?? "none"}, limit=${limit})`, async () => {
        const batched = await listThreadsByNotebook(TENANT, NB, limit, { viewerUserId: viewer });
        for (const nb of NB) {
          const single = await listThreads(TENANT, nb, limit, { viewerUserId: viewer });
          expect(batched.get(nb) ?? [], nb).toEqual(single);
        }
      });
    }
  }

  it("covers the cases it claims to: limits bite, owners and pending turns are filtered", async () => {
    const full = await listThreadsByNotebook(TENANT, NB, 20, { viewerUserId: "viewer" });
    expect(full.get(NB[0])?.map((t) => t.id)).toEqual(["thrd_3", "thrd_2", "thrd_1", "legacy", "thrd_0"]);
    expect(full.get(NB[2])?.map((t) => t.id)).toEqual(["thrd_x"]);
    expect(full.has(NB[3])).toBe(false);
    const capped = await listThreadsByNotebook(TENANT, NB, 2, { viewerUserId: "viewer" });
    expect(capped.get(NB[0])?.map((t) => t.id)).toEqual(["thrd_3", "thrd_2"]);
  });

  it("runs no query for an empty notebook list", async () => {
    const spy = vi.spyOn(testPool, "connect");
    expect((await listThreadsByNotebook(TENANT, [], 20)).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
