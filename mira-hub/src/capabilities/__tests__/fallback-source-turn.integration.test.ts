/**
 * F004 §5 against REAL Postgres: the turn a general-guidance request links to
 * (`fallbackOf`) is found by its row id OR by the request id the client sent
 * it with — a phone holds only the latter for a turn it just received live —
 * and only inside the caller's own tenant, notebook, owner and thread, on a
 * completed row. The link always resolves to the canonical ROW id.
 *
 * Run: cd mira-hub && TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE node scripts/setup-integration-db.mjs
 *      && npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/fallback-source-turn
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TENANT_A = "aaaaaaaa-0000-4000-8000-0000000000f4";
const TENANT_B = "bbbbbbbb-0000-4000-8000-0000000000f4";
const OWNER = "fallback-owner";
const OTHER_OWNER = "fallback-other-owner";
const REQ = "c0ffee00-0000-4000-8000-000000000001";
const REQ_PENDING = "c0ffee00-0000-4000-8000-000000000002";
const REQ_OTHER_OWNER = "c0ffee00-0000-4000-8000-000000000003";
const REQ_OTHER_THREAD = "c0ffee00-0000-4000-8000-000000000004";

const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});

vi.mock("@/lib/db", () => ({ default: pool }));

import { getFallbackSourceTurn } from "@/lib/equipment-notebooks";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let nbA = "";
let nbA2 = "";
let nbB = "";
let rowId = "";

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

async function turn(opts: {
  tenant: string;
  nb: string;
  owner: string | null;
  thread: string | null;
  req: string | null;
  state?: "complete" | "pending";
}): Promise<string> {
  const r = await q(
    `INSERT INTO equipment_notebook_turns
       (notebook_id, tenant_id, question, answer_status, owner_user_id, thread_id, client_request_id, client_request_state, evidence)
     VALUES ($1::uuid, $2::uuid, 'What does F004 mean', 'insufficient_evidence', $3, $4, $5::uuid, $6,
             '[{"kind":"grounding_status","fallback":{"offered":true}}]'::jsonb)
     RETURNING id::text AS id`,
    [opts.nb, opts.tenant, opts.owner, opts.thread, opts.req, opts.state ?? "complete"],
  );
  return r.rows[0].id;
}

run("getFallbackSourceTurn (integration)", () => {
  beforeAll(async () => {
    nbA = await notebook(TENANT_A, "Line 1 drive");
    nbA2 = await notebook(TENANT_A, "Line 2 drive");
    nbB = await notebook(TENANT_B, "Other tenant drive");
    rowId = await turn({ tenant: TENANT_A, nb: nbA, owner: OWNER, thread: "thrd-1", req: REQ });
    await turn({ tenant: TENANT_A, nb: nbA, owner: OWNER, thread: "thrd-1", req: REQ_PENDING, state: "pending" });
    await turn({ tenant: TENANT_A, nb: nbA, owner: OTHER_OWNER, thread: "thrd-1", req: REQ_OTHER_OWNER });
    await turn({ tenant: TENANT_A, nb: nbA, owner: OWNER, thread: "thrd-2", req: REQ_OTHER_THREAD });
    // The same request id in another notebook and another tenant (unique only per notebook+owner).
    await turn({ tenant: TENANT_A, nb: nbA2, owner: OWNER, thread: "thrd-1", req: REQ });
    await turn({ tenant: TENANT_B, nb: nbB, owner: OWNER, thread: "thrd-1", req: REQ });
  });

  afterAll(async () => {
    await q(`DELETE FROM equipment_notebook_turns WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT_A, TENANT_B]);
    await q(`DELETE FROM equipment_notebooks WHERE tenant_id IN ($1::uuid, $2::uuid)`, [TENANT_A, TENANT_B]);
    await pool.end();
  });

  const look = (turnId: string, o: { tenant?: string; nb?: string; owner?: string; thread?: string | null } = {}) =>
    getFallbackSourceTurn(o.tenant ?? TENANT_A, o.nb ?? nbA, {
      ownerUserId: o.owner ?? OWNER,
      threadId: o.thread === undefined ? "thrd-1" : o.thread,
      turnId,
    });

  it("control: finds the owner's completed turn by its row id", async () => {
    const row = await look(rowId);
    expect(row?.id).toBe(rowId);
    expect(row?.evidence).toEqual([{ kind: "grounding_status", fallback: { offered: true } }]);
  });

  it("finds the same turn by the request id it was sent with, and returns the ROW id", async () => {
    const row = await look(REQ);
    expect(row?.id).toBe(rowId);
  });

  it("the request id of a turn that is still pending never qualifies", async () => {
    expect(await look(REQ_PENDING)).toBeNull();
  });

  it("another technician's request id never qualifies (strict owner)", async () => {
    expect(await look(REQ_OTHER_OWNER)).toBeNull();
    expect(await look(REQ_OTHER_OWNER, { owner: OTHER_OWNER })).not.toBeNull(); // control: their own
  });

  it("a request id from another thread never qualifies", async () => {
    expect(await look(REQ_OTHER_THREAD)).toBeNull();
  });

  it("the same request id resolves inside the caller's notebook only, never another notebook's or tenant's row", async () => {
    const inA2 = await look(REQ, { nb: nbA2 });
    expect(inA2).not.toBeNull();
    expect(inA2?.id).not.toBe(rowId);
    const inB = await look(REQ, { tenant: TENANT_B, nb: nbB });
    expect(inB).not.toBeNull();
    expect(inB?.id).not.toBe(rowId);
    // Tenant A's caller cannot reach tenant B's notebook at all.
    expect(await look(REQ, { tenant: TENANT_A, nb: nbB })).toBeNull();
  });
});
