/**
 * #3966/#3970: exercise the actual BM25 SQL against a disposable Postgres.
 * The integration connection gets a TEMP knowledge_entries table, so no
 * persistent corpus row or schema is created or changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveManualChunks } from "../manual-rag";

const TENANT = "39700000-0000-4000-8000-000000000001";
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
      tenant_id text NOT NULL,
      content text NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      manufacturer text NOT NULL,
      model_number text NOT NULL,
      source_url text NOT NULL,
      source_page integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      verified boolean NOT NULL DEFAULT true,
      is_private boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP
  `);
  for (const model of [
    "TP700", "TP700 Comfort", "KTP700", "TP7000", "TP7001", "SINAMICS V20",
    "PowerFlex 525", "PowerFlex 5250", "AX%_7", "AXZZ7", "AX.7", "AXZ7",
    "12AX%_7", "12AXZZ7",
  ]) {
    await client.query(
      `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url)
       VALUES ($1, 'panel supply specification', 'Siemens', $2, $3)`,
      [TENANT, model, `https://test.invalid/${encodeURIComponent(model)}`],
    );
  }
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  if (pool) await pool.end();
});

async function modelsFor(model: string): Promise<string[]> {
  const hits = await retrieveManualChunks(client, TENANT, "panel supply", {
    manufacturer: "Siemens", model, equipmentType: "Other", topK: 20,
  });
  return hits.map((hit) => hit.modelNumber).sort();
}

describe("identity-bound OEM model SQL", () => {
  it("admits TP700 and TP700 Comfort, never KTP700, TP7000, TP7001, or V20", async () => {
    expect(await modelsFor("TP700")).toEqual(["TP700", "TP700 Comfort"]);
  });

  it("still retrieves the numeric legacy model token within PowerFlex 525", async () => {
    expect(await modelsFor("525")).toEqual(["PowerFlex 525"]);
  });

  it("treats unknown percent, underscore, and regex punctuation as literal identity", async () => {
    expect(await modelsFor("AX%_7")).toEqual(["AX%_7"]);
    expect(await modelsFor("AX.7")).toEqual(["AX.7"]);
    expect(await modelsFor("12AX%_7")).toEqual(["12AX%_7"]);
  });
});
