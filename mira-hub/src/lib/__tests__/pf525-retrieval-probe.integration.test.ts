// #3218 diagnostic probe — the prod corpus is PROVEN complete (expected 746 ==
// stored 746, pages 274 == 274), yet narrow questions abstain on content that
// exists in the chunks (F013 Ground Fault on p161, ambient temp, overvoltage).
// This probe reproduces the EXACT route composition (buildRetrievalQuery →
// retrieveNodeChunks topK=6 docIds rawQuery) against a disposable Postgres
// loaded by the REAL ingest pipeline, to locate the retrieval-side failure.
//
// Requires (all local/disposable — never staging/prod):
//   TEST_DATABASE_URL      postgres with pgvector available
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
//   PF525_PDF_PATH         the full pf525_user_manual.pdf
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/pf525-retrieval-probe.integration.test.ts

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const PDF_PATH = process.env.PF525_PDF_PATH ?? "";
const READY = Boolean(
  process.env.TEST_DATABASE_URL &&
    process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" &&
    PDF_PATH &&
    fs.existsSync(PDF_PATH),
);

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({
      connectionString: process.env.TEST_DATABASE_URL,
    }) as Pool,
  };
});

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (
    _tenantId: string,
    fn: (c: PoolClient) => Promise<unknown>,
  ) => {
    const c = await testPool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  },
}));

import { writePdfChunksForNode } from "../node-knowledge-ingest";
import { retrieveNodeChunks, type ManualChunk } from "../manual-rag";
import { buildRetrievalQuery } from "../notebook-query";

const TENANT = randomUUID();
const NODE = randomUUID();
const DOC = randomUUID();

const hubRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(hubRoot, "..");

async function applySchema(): Promise<void> {
  const files = [
    path.join(repoRoot, "docs", "migrations", "001_knowledge_entries.sql"),
    path.join(hubRoot, "db", "migrations", "045_knowledge_entries_chunk_anchors.sql"),
  ];
  await testPool.query("CREATE EXTENSION IF NOT EXISTS vector");
  for (const f of files) {
    await testPool.query(fs.readFileSync(f, "utf8"));
  }
  await testPool.query(`
    ALTER TABLE knowledge_entries
      ADD COLUMN IF NOT EXISTS content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
  `);
  await testPool.query(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_content_tsv
      ON knowledge_entries USING GIN (content_tsv);
  `);
  await testPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_tenant_source_chunk
      ON knowledge_entries (tenant_id, source_url, ((metadata->>'chunk_index')::int))
      WHERE metadata->>'chunk_index' IS NOT NULL;
  `);
}

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await testPool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/** EXACT route composition (chat/route.ts:236-244), single-turn (no history). */
async function ask(message: string): Promise<ManualChunk[]> {
  const retrievalQuery = buildRetrievalQuery(message, []);
  return withClient((c) =>
    retrieveNodeChunks(c, TENANT, retrievalQuery, {
      nodeId: NODE,
      unsPath: null,
      topK: 6,
      docIds: [DOC],
      rawQuery: message,
    }),
  );
}

function report(label: string, chunks: ManualChunk[], markerRe: RegExp): boolean {
  const hit = chunks.some((c) => markerRe.test(c.content));
  const pages = chunks.map((c) => c.sourcePage ?? "?").join(",");
  // eslint-disable-next-line no-console
  console.log(
    `PROBE ${label}: retrieved=${chunks.length} pages=[${pages}] marker=${hit ? "HIT" : "MISS"}`,
  );
  if (!hit && chunks.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`   top1(p${chunks[0].sourcePage}): ${chunks[0].content.slice(0, 140)}`);
  }
  return hit;
}

describe.skipIf(!READY)("#3218 probe — PF525 retrieval over a PROVEN-complete corpus", () => {
  beforeAll(async () => {
    await applySchema();
    const n = await writePdfChunksForNode({
      tenantId: TENANT,
      uploadId: DOC,
      nodeId: NODE,
      unsPath: null,
      filename: "pf525_user_manual.pdf",
      buffer: fs.readFileSync(PDF_PATH),
    });
    // Accounting: local pipeline replica measured 746 expected; assert parity.
    // eslint-disable-next-line no-console
    console.log(`ingested chunks=${n}`);
    expect(n).toBe(746);
  }, 300_000);

  afterAll(async () => {
    await testPool.end();
  });

  it("controls: F004 + decel-parameter questions retrieve their evidence", async () => {
    const f004 = report("control-f004", await ask("what does fault F004 mean?"), /F004/i);
    const decel = report(
      "control-decel",
      await ask("what parameter sets the deceleration time?"),
      /P042|Decel/i,
    );
    expect(f004).toBe(true);
    expect(decel).toBe(true);
  }, 120_000);

  it("DIAGNOSTIC: the four prod-abstaining questions vs their in-corpus evidence", async () => {
    const groundFault = report(
      "ground-fault",
      await ask("what fault does the drive show for a ground fault?"),
      /F013|ground\s*fault/i,
    );
    const overvoltage = report(
      "overvoltage-protection",
      await ask("does the drive have overvoltage protection?"),
      /over\s*-?\s*voltage/i,
    );
    const ambient = report(
      "ambient-temp",
      await ask("what is the ambient operating temperature range of the drive?"),
      /ambient/i,
    );
    const protections = report(
      "broad-protections",
      await ask("what protections does this drive have?"),
      /protection/i,
    );
    // Diagnostic stage: log-only — the assertion tightens once the failure
    // boundary is identified and fixed.
    // eslint-disable-next-line no-console
    console.log(
      `SUMMARY ground-fault=${groundFault} overvoltage=${overvoltage} ambient=${ambient} protections=${protections}`,
    );
  }, 240_000);
});
