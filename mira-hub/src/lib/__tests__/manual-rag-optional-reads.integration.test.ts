/**
 * The T-1 ranking fix (#4979) added two optional reads to retrieveNodeChunks —
 * the code-selectivity count and the question-IDF table — that run on the
 * CALLER's client inside withTenantContext's transaction. A statement that
 * fails there leaves the transaction aborted, and every later SELECT dies with
 * 25P02 (Codex F1 on #4979). Each read runs under a SAVEPOINT, like the vector
 * lane: this test makes each one fail on a real PostgreSQL transaction and
 * checks that retrieval still answers and the connection stays usable.
 *
 * Real SQL, disposable Postgres (TEST_DATABASE_URL + MIRA_TEST_DB_CONFIRM),
 * vitest.integration.config.ts. Zero tokens.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("retrieveNodeChunks — optional reads recover the transaction (Codex F1 on #4979)", () => {
  const client = new Client({ connectionString: url });
  const T = "39700000-0000-4000-8000-000000004979";
  const DOC = "39700000-0000-4000-8000-0000000049d1";
  const NODE = "node-4979";

  beforeAll(async () => {
    await client.connect();
    await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [T]);
    const seed = async (page: number, content: string) =>
      client.query(
        `INSERT INTO knowledge_entries
           (tenant_id, content, manufacturer, model_number, source_url, source_page, page_start,
            doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'node-doc/d/manual.pdf', $3, $3, $4, 'v2', $5, true, true)`,
        [T, content, page, DOC, JSON.stringify({ node_id: NODE, chunk_index: page, filename: "manual.pdf" })],
      );
    await seed(1, "Controller user manual. Hardware overview and installation.");
    await seed(93, "F81 Comm Loss: the RS485 (DSI) port stopped communicating. Check the cable, the adapter and the DSI connection.");
    await seed(94, "F5 OverVoltage: DC bus voltage exceeded maximum value. Extend the decel time or install dynamic brake option.");
  });
  afterAll(async () => {
    await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1", [T]);
    await client.end();
  });

  /** A client whose first statement matching `marker` is preceded by a failing
   *  statement on the SAME connection (1/0), so the failure is a real server-side
   *  error inside the open transaction — exactly what a timeout would do. */
  function failingOnce(marker: string): PoolClient {
    let fired = false;
    return {
      query: async (sql: string, params?: unknown[]) => {
        if (!fired && sql.includes(marker)) {
          fired = true;
          await client.query("SELECT 1/0");
        }
        return client.query(sql, params);
      },
    } as unknown as PoolClient;
  }

  const ask = (c: PoolClient, q: string) =>
    retrieveNodeChunks(c, T, q, { nodeId: NODE, unsPath: null, topK: 6, docIds: [DOC], rawQuery: q, validatedDocScope: true });

  it("a failing code-selectivity count does not abort the caller's transaction", async () => {
    await client.query("BEGIN");
    try {
      const out = await ask(failingOnce("WITH ORDINALITY"), "F81 fault after every power cycle, comm loss on the DSI port");
      expect(out.map((c) => c.sourcePage)).toContain(93);
      expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1); // connection still usable
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("a failing question-IDF lookup does not abort the caller's transaction", async () => {
    await client.query("BEGIN");
    try {
      const out = await ask(failingOnce("names_document"), "the dc bus overvoltage trips during decel, how do I extend the decel time");
      expect(out.map((c) => c.sourcePage)).toContain(94);
      expect((await client.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("control: with no failure both reads run and the same pages come back", async () => {
    await client.query("BEGIN");
    try {
      const out = await ask(client as unknown as PoolClient, "F81 fault after every power cycle, comm loss on the DSI port");
      expect(out.map((c) => c.sourcePage)).toContain(93);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
