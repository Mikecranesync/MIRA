/**
 * Codex r1 on #4487 — the optional vector lane must never leave the caller's
 * transaction aborted. Reproduced: with NOTEBOOK_HYBRID_RETRIEVAL on, a vector
 * SELECT failing with 57014 (statement timeout) on the caller's client inside
 * withTenantContext's transaction returned the lexical chunks fine — and the
 * caller's NEXT query failed with 25P02, so the namespace node route dropped
 * its row and answered 404 "node not found".
 *
 * The lane now runs under a SAVEPOINT and rolls back to it on failure. A raw
 * pool caller (no transaction) sees SAVEPOINT fail with 25P01 and nothing is
 * recovered — the lane still falls back to lexical and the pool stays usable.
 *
 * Lives under capabilities/__tests__ (ungated).
 * Run: npx vitest run src/capabilities/__tests__/hybrid-vector-lane-savepoint.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { retrieveNodeChunks } from "../../lib/manual-rag";

const VEC = Array.from({ length: 768 }, (_, i) => (i % 5) / 10);
const lexRow = (page: number, content: string) => ({
  content,
  source_url: "node-doc/u1/gs10.pdf",
  source_page: page,
  page_start: page,
  section_path: null,
  filename: "gs10.pdf",
  doc_id: "d-1",
  rank: 0.5 - page * 0.01,
});
const LEXICAL = [lexRow(10, "Carrier frequency P2.04 sets the PWM switching frequency."), lexRow(11, "Carrier frequency and audible motor noise.")];

/**
 * A client that models Postgres transaction state: once a statement fails
 * inside a transaction every later statement fails with 25P02 until a
 * ROLLBACK TO SAVEPOINT restores the savepoint taken before the failure.
 */
function txnClient(opts: { inTransaction: boolean; vectorFails: boolean }) {
  const calls: string[] = [];
  let aborted = false;
  let savepointTaken = false;
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const query = vi.fn(async (sql: string) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/^\s*SAVEPOINT/i.test(sql)) {
      if (!opts.inTransaction) throw pgError("25P01", "SAVEPOINT can only be used in transaction blocks");
      savepointTaken = true;
      return { rows: [] };
    }
    if (/^\s*ROLLBACK TO SAVEPOINT/i.test(sql)) {
      if (!savepointTaken) throw pgError("3B001", "savepoint does not exist");
      aborted = false;
      return { rows: [] };
    }
    if (/^\s*RELEASE SAVEPOINT/i.test(sql)) return { rows: [] };
    if (aborted) throw pgError("25P02", "current transaction is aborted, commands ignored until end of transaction block");
    if (sql.includes("<=>")) {
      if (opts.vectorFails) {
        if (opts.inTransaction) aborted = true;
        throw pgError("57014", "canceling statement due to statement timeout");
      }
      return { rows: [] };
    }
    if (sql.includes("ts_rank_cd")) return { rows: LEXICAL };
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  return { client, calls, isAborted: () => aborted };
}

const ask = (client: PoolClient) =>
  retrieveNodeChunks(client, "t-1", "what carrier frequency should I use", {
    nodeId: "n-1",
    unsPath: null,
    docIds: ["d-1"],
    validatedDocScope: true,
    topK: 3,
    identity: { manufacturer: "AutomationDirect", model: "GS10" },
    identityStatus: "user_confirmed",
  });

afterEach(() => {
  delete process.env.NOTEBOOK_HYBRID_RETRIEVAL;
  delete process.env.OLLAMA_BASE_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function enableHybrid() {
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "1";
  process.env.OLLAMA_BASE_URL = "http://embedder.test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: VEC }), { status: 200 })));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("hybrid vector lane — a failing vector SELECT must not abort the caller's transaction (Codex r1 F1 on #4487)", () => {
  it("inside a transaction: the lane is rolled back to its savepoint, the lexical result is served, and the NEXT query on the same client still works", async () => {
    enableHybrid();
    const { client, calls, isAborted } = txnClient({ inTransaction: true, vectorFails: true });
    const out = await ask(client);
    expect(out.map((c) => c.sourcePage)).toEqual([10, 11]);
    expect(calls).toContain("SAVEPOINT hybrid_vector_lane");
    expect(calls.indexOf("ROLLBACK TO SAVEPOINT")).toBeGreaterThan(calls.indexOf("SAVEPOINT hybrid_vector_lane"));
    // Precondition the finding rests on: the vector statement DID abort the transaction…
    expect(calls.some((c) => c.startsWith("SELECT"))).toBe(true);
    // …and the recovery left it usable — the caller's follow-up query succeeds.
    expect(isAborted()).toBe(false);
    await expect(client.query("SELECT 1 FROM kg_entities WHERE false", [])).resolves.toEqual({ rows: [] });
  });

  it("control: without the savepoint recovery the same client would reject the follow-up with 25P02 (the reproduced failure)", async () => {
    // The transaction model itself, with no ROLLBACK TO — proves the fixture can
    // express the defect, so the test above is not passing vacuously.
    const { client, isAborted } = txnClient({ inTransaction: true, vectorFails: true });
    await expect(client.query("SELECT 1 WHERE embedding <=> x", [])).rejects.toMatchObject({ code: "57014" });
    expect(isAborted()).toBe(true);
    await expect(client.query("SELECT 1", [])).rejects.toMatchObject({ code: "25P02" });
  });

  it("raw pool caller (no transaction): SAVEPOINT is refused (25P01), the lane still falls back to lexical, and no ROLLBACK TO is attempted", async () => {
    enableHybrid();
    const { client, calls } = txnClient({ inTransaction: false, vectorFails: true });
    const out = await ask(client);
    expect(out.map((c) => c.sourcePage)).toEqual([10, 11]);
    expect(calls).toContain("SAVEPOINT hybrid_vector_lane");
    expect(calls.some((c) => c.startsWith("ROLLBACK TO"))).toBe(false);
  });

  it("control: a vector lane that succeeds releases its savepoint and never rolls back", async () => {
    enableHybrid();
    const { client, calls } = txnClient({ inTransaction: true, vectorFails: false });
    await ask(client);
    expect(calls).toContain("RELEASE SAVEPOINT hybrid_vector_lane");
    expect(calls.some((c) => c.startsWith("ROLLBACK TO"))).toBe(false);
  });

  it("control: flag OFF issues no savepoint at all", async () => {
    const { client, calls } = txnClient({ inTransaction: true, vectorFails: true });
    await ask(client);
    expect(calls.some((c) => /SAVEPOINT/.test(c))).toBe(false);
  });
});
