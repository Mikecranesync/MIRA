/**
 * #4597: NOTEBOOK_LEXICAL_V2 must rank identical rows identically, whatever their
 * physical row order. Real notebook SQL against a disposable Postgres; the connection
 * gets a TEMP knowledge_entries table, so no persistent row or schema is touched.
 *
 * A float8 IDF sum adds its terms in an order that follows the physical row layout, and
 * float addition is not associative, so the same chunk scored differently in the last
 * bits after a reload and near-tied pages swapped between identical runs. Four documents
 * hold identical chunks written in different row orders; scores are per-document (N and
 * df come from the doc's own rows), so all four must return identical pages AND scores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const T = "39700000-0000-4000-8000-000000004597";
let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("A confirmed disposable TEST_DATABASE_URL is required");
  }
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE knowledge_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      content text NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      manufacturer text NOT NULL,
      model_number text NOT NULL,
      source_url text NOT NULL,
      source_page integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      verified boolean NOT NULL DEFAULT true,
      is_private boolean NOT NULL DEFAULT false,
      doc_id uuid,
      ingest_route text,
      page_start integer,
      section_path text
    ) ON COMMIT DROP
  `);
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  if (pool) await pool.end();
});

async function seed(doc: string, page: number, content: string) {
  await client.query(
    `INSERT INTO knowledge_entries
       (tenant_id, content, manufacturer, model_number, source_url, source_page, page_start,
        doc_id, ingest_route, metadata, verified, is_private)
     VALUES ($1, $2, '', '', 'https://test.invalid/det.pdf', $3, $3, $4, 'v2', '{"node_id":"n4597"}', true, true)`,
    [T, content, page, doc],
  );
}

describe("NOTEBOOK_LEXICAL_V2 ordering is deterministic (#4597)", () => {
  it("identical rows rank identically whatever their physical row order", async () => {
    const docs = ["0000000045b1", "0000000045b2", "0000000045b3", "0000000045b4"].map((s) => `39700000-0000-4000-8000-${s}`);
    let x = 4597;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const word = () =>
      Array.from({ length: 7 }, () => "bcdfghjklmnprstvz"[Math.floor(rnd() * 17)] + "aeiou"[Math.floor(rnd() * 5)])
        .join("")
        .slice(0, 6 + Math.floor(rnd() * 6));
    const vocab = Array.from({ length: 300 }, word);
    const rows = Array.from({ length: 240 }, (_, i) => ({
      page: i + 1,
      text: Array.from({ length: 20 + Math.floor(rnd() * 100) }, () => vocab[Math.floor(rnd() * vocab.length)]).join(" "),
    }));
    const question = vocab.slice(0, 12).join(" ");
    const layouts = [rows, [...rows].reverse(), [...rows].sort((a, b) => a.text.localeCompare(b.text)), [...rows.slice(120), ...rows.slice(0, 120)]];
    for (const [i, layout] of layouts.entries()) for (const r of layout) await seed(docs[i], r.page, r.text);

    const prev = process.env.NOTEBOOK_LEXICAL_V2;
    process.env.NOTEBOOK_LEXICAL_V2 = "1";
    try {
      const results: string[] = [];
      for (const doc of docs) {
        const hits = await retrieveNodeChunks(client, T, question, {
          nodeId: "n4597", unsPath: null, topK: 24, docIds: [doc], rawQuery: question, validatedDocScope: true,
        });
        results.push(JSON.stringify(hits.map((h) => [h.sourcePage, h.rank])));
      }
      expect(JSON.parse(results[0])).toHaveLength(24);
      for (const r of results.slice(1)) expect(r).toBe(results[0]);
    } finally {
      if (prev === undefined) delete process.env.NOTEBOOK_LEXICAL_V2;
      else process.env.NOTEBOOK_LEXICAL_V2 = prev;
    }
  });
});
