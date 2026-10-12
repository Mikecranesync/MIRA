/**
 * #3331 / #4373 Codex R1 F1: rows that tie on rank, source_url, source_page and
 * chunk_index must still come back in one fixed order, so the same question
 * cites the same chunk every time. chunk_index is not unique (public rows span
 * tenants; it may be null), so the primary key is the final discriminator.
 * Runs the real BM25 SQL against a disposable Postgres on a TEMP table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveManualChunks } from "../manual-rag";

const CALLER = "39700000-0000-4000-8000-0000000000aa";
const OTHER_TENANT = "39700000-0000-4000-8000-0000000000bb";
const LOW_ID = "00000000-0000-4000-8000-000000000001";
const HIGH_ID = "00000000-0000-4000-8000-000000000002";
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
      id uuid PRIMARY KEY,
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

/** Insert the HIGH id first so physical order alone would return it. */
async function seedTie(question: string, metadata: object, tenants: [string, string]) {
  await client.query("DELETE FROM knowledge_entries");
  for (const [id, tenant, model] of [
    [HIGH_ID, tenants[1], "TIE-HIGH"],
    [LOW_ID, tenants[0], "TIE-LOW"],
  ]) {
    await client.query(
      `INSERT INTO knowledge_entries (id, tenant_id, content, manufacturer, model_number, source_url, source_page, metadata)
       VALUES ($1, $2, $3, 'Siemens', $4, 'https://test.invalid/tie.pdf', 7, $5::jsonb)`,
      [id, tenant, `${question} specification`, model, JSON.stringify(metadata)],
    );
  }
}

async function topOne(question: string): Promise<string | undefined> {
  const hits = await retrieveManualChunks(client, CALLER, question, { topK: 1 });
  expect(hits).toHaveLength(1);
  return hits[0]?.modelNumber;
}

describe("tied knowledge_entries rows resolve by primary key (#4373 R1 F1)", () => {
  it("same chunk_index under two public tenants: the lower id wins", async () => {
    await seedTie("panel supply", { chunk_index: 3 }, [CALLER, OTHER_TENANT]);
    expect(await topOne("panel supply")).toBe("TIE-LOW");
  });

  it("no chunk_index at all: the lower id wins", async () => {
    await seedTie("panel supply", {}, [CALLER, CALLER]);
    expect(await topOne("panel supply")).toBe("TIE-LOW");
  });

  it("the answer is identical across repeated runs", async () => {
    await seedTie("panel supply", {}, [CALLER, OTHER_TENANT]);
    const runs = new Set<string | undefined>();
    for (let i = 0; i < 5; i++) runs.add(await topOne("panel supply"));
    expect([...runs]).toEqual(["TIE-LOW"]);
  });
});
