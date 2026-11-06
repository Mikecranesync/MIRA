/** Real five-connection pool: concurrent page restores must not acquire a
 * transaction for every notebook. Replays the 71-notebook, three-tab workload
 * without a shared database, model call or mocked thread query. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const RUN = Boolean(process.env.TEST_DATABASE_URL) && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE";
const { pool, session } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 }), session: vi.fn() };
});
vi.mock("@/lib/db", () => ({ default: pool }));
vi.mock("@/lib/session", () => ({ sessionOr401: session }));
vi.mock("@/capabilities/notebook-manual-acquisition", () => ({ startManualAcquisition: vi.fn() }));
import { GET } from "@/app/api/equipment-notebooks/route";
const TENANT = randomUUID(), EMPTY_TENANT = randomUUID(), VIEWER = randomUUID(), OTHER_USER = randomUUID();
const ids: string[] = [];
describe.skipIf(!RUN)("notebook restore query budget (real Postgres, five-connection pool)", () => {
  beforeAll(async () => {
    const seeded = await pool.query(
      `INSERT INTO equipment_notebooks (tenant_id, display_name, node_id)
       SELECT $1::uuid, 'restore-' || n, gen_random_uuid() FROM generate_series(1, 71) n RETURNING id::text`, [TENANT]);
    ids.push(...seeded.rows.map((r: { id: string }) => r.id));
    for (const [thread, owner, state, minute] of [
      ["own", VIEWER, "complete", 1], ["private-other", OTHER_USER, "complete", 2],
      ["pending", VIEWER, "pending", 3], [null, null, "complete", 4],
    ] as const) {
      await pool.query(
        `INSERT INTO equipment_notebook_turns
           (notebook_id, tenant_id, thread_id, question, answer_text, owner_user_id, client_request_state, created_at)
         VALUES ($1::uuid, $2::uuid, $3, 'restore fixture', 'fixture answer', $4, $5,
           timestamptz '2026-11-01T00:00:00Z' + make_interval(mins => $6))`,
        [ids[0], TENANT, thread, owner, state, minute]);
    }
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query("DELETE FROM equipment_notebook_turns WHERE tenant_id=$1::uuid", [TENANT]);
    await pool.query("DELETE FROM equipment_notebooks WHERE tenant_id=$1::uuid", [TENANT]);
    await pool.end();
  });
  it("restores three 71-notebook pages with six tenant transactions, preserving visible threads", async () => {
    session.mockResolvedValue({ tenantId: TENANT, userId: VIEWER });
    const leases = vi.spyOn(pool, "connect");
    try {
      const responses = await Promise.all([GET(), GET(), GET()]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.notebooks.map((n: { id: string }) => n.id).sort()).toEqual([...ids].sort());
        const populated = body.notebooks.find((n: { id: string }) => n.id === ids[0]);
        expect(populated.threads.map((t: { id: string }) => t.id)).toEqual(["legacy", "own"]);
        expect(body.notebooks.filter((n: { id: string }) => n.id !== ids[0]).every(
          (n: { threads: unknown[] }) => n.threads.length === 0)).toBe(true);
      }
      // One notebook-list transaction plus one batched thread transaction per request.
      expect(leases).toHaveBeenCalledTimes(6);
    } finally { leases.mockRestore(); }
  });
  it("an empty workspace consumes one transaction and returns no other tenant's notebooks", async () => {
    session.mockResolvedValue({ tenantId: EMPTY_TENANT, userId: VIEWER });
    const leases = vi.spyOn(pool, "connect");
    try {
      const response = await GET();
      expect(response.status).toBe(200);
      expect((await response.json()).notebooks).toEqual([]);
      expect(leases).toHaveBeenCalledTimes(1);
    } finally { leases.mockRestore(); }
  });
});
