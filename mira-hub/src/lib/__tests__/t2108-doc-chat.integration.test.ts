// ARPK Phase 1f — the T2108 proof: a consumer manual the industrial alias
// table has never seen goes upload → v2 chunks → DOC-SCOPED retrieval, against
// a REAL disposable Postgres. This is the PRD's golden benchmark run at the
// retrieval layer (no LLM): every question asserts the retrieved top-K contains
// the manual fact, and gate F asserts a doc-scoped ask can never surface a
// sibling document's chunks.
//
// Requires (all local/disposable — never staging/prod):
//   TEST_DATABASE_URL      postgres with the pgvector extension available
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
//   T2108_PDF_PATH         the fetched official manual
//                          (py tests/beta/fixtures/t2108/fetch.py)
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/t2108-doc-chat.integration.test.ts

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const PDF_PATH = process.env.T2108_PDF_PATH ?? "";
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

// uploads.ts (createUpload/findDuplicateUpload) runs on the test pool…
vi.mock("@/lib/db", () => ({ default: testPool }));
// …and the chunk writer's withTenantContext hands out a test-pool client (the
// real wrapper does RLS SET LOCAL; tenant isolation itself is covered by the
// rls-deny suite — here we prove ingest + retrieval semantics).
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

import { writePdfChunksForNode, writeTextChunksForNode, NoExtractableTextError } from "../node-knowledge-ingest";
import { retrieveNodeChunks, type ManualChunk } from "../manual-rag";

const TENANT = randomUUID();
const NODE = randomUUID();
const T2108_DOC = randomUUID(); // stands in for hub_uploads.id → knowledge_entries.doc_id
const DECOY_DOC = randomUUID();

const hubRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(hubRoot, "..");

/** Minimal real-schema bootstrap, assembled from the canonical migrations. */
async function applySchema(): Promise<void> {
  const files = [
    path.join(repoRoot, "docs", "migrations", "001_knowledge_entries.sql"),
    path.join(hubRoot, "db", "migrations", "045_knowledge_entries_chunk_anchors.sql"),
  ];
  await testPool.query("CREATE EXTENSION IF NOT EXISTS vector");
  for (const f of files) {
    await testPool.query(fs.readFileSync(f, "utf8"));
  }
  // content_tsv generated column + GIN index — canonical DDL lives in
  // mira-core/mira-ingest/db/migrations/006_knowledge_tsvector.sql, which uses
  // CREATE INDEX CONCURRENTLY (not runnable in a script batch). Same shape:
  await testPool.query(`
    ALTER TABLE knowledge_entries
      ADD COLUMN IF NOT EXISTS content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
  `);
  await testPool.query(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_entries_content_tsv
      ON knowledge_entries USING GIN (content_tsv);
  `);
  // The partial UNIQUE the chunk writer's ON CONFLICT targets (hub mig 003).
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

/** Doc-scoped top-K for one question. */
async function ask(question: string, docId: string): Promise<ManualChunk[]> {
  return withClient((c) =>
    retrieveNodeChunks(c, TENANT, question, { nodeId: NODE, unsPath: null, docId }),
  );
}

const hasAll = (chunks: ManualChunk[], markers: string[]): boolean => {
  const text = chunks.map((c) => c.content.toLowerCase()).join("\n");
  return markers.every((m) => text.includes(m.toLowerCase()));
};

describe.skipIf(!READY)("T2108 — upload any manual and chat with it (retrieval layer)", () => {
  let chunkCount = 0;

  beforeAll(async () => {
    await applySchema();
    await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);

    chunkCount = await writePdfChunksForNode({
      tenantId: TENANT,
      uploadId: T2108_DOC,
      nodeId: NODE,
      unsPath: null,
      filename: "T2108_Manual_EN.pdf",
      buffer: fs.readFileSync(PDF_PATH),
    });

    // Gate F needs a sibling document on the SAME node — a second, unrelated
    // manual (the beta-gate GS10 fixture, a real industrial PDF).
    const gs10 = path.join(repoRoot, "tests", "beta", "fixtures", "gs10_fault_codes.pdf");
    await writePdfChunksForNode({
      tenantId: TENANT,
      uploadId: DECOY_DOC,
      nodeId: NODE,
      unsPath: null,
      filename: "gs10_fault_codes.pdf",
      buffer: fs.readFileSync(gs10),
    });
  }, 120_000);

  afterAll(async () => {
    await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);
    await testPool.end();
  });

  it("ingests the manual: >0 chunks, is_private=true, real page anchors, doc_id stamped", async () => {
    expect(chunkCount).toBeGreaterThan(10);
    const { rows } = await testPool.query(
      `SELECT COUNT(*)::int AS n,
              BOOL_AND(is_private) AS all_private,
              BOOL_AND(doc_id = $2::uuid) AS all_doc,
              COUNT(DISTINCT page_start)::int AS pages,
              MAX(page_end)::int AS max_page
         FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2::uuid`,
      [TENANT, T2108_DOC],
    );
    expect(rows[0].n).toBe(chunkCount);
    expect(rows[0].all_private).toBe(true);
    expect(rows[0].all_doc).toBe(true);
    // 16-page manual, page 16 blank → anchors span most of the document.
    expect(rows[0].pages).toBeGreaterThanOrEqual(10);
    expect(rows[0].max_page).toBeLessThanOrEqual(16);
  });

  // ── Golden questions (PRD § "T2108 golden benchmark"), retrieval layer ────
  //
  // MEASURED RESULT (2026-08-10, ephemeral pgvector/pg16): 3/6 natural-language
  // goldens retrieve; the 3 misses are ALL questions whose answer lives in the
  // Specifications TABLE (PDF p.15: "Input 19 V 0.6 A", "14.4 V / 2600 mAh",
  // "Cleaning Time Max. 100 mins"). Terse key:value table rows share almost no
  // tokens with a natural question, so BM25's AND pass zeroes and the OR pass
  // ranks prose pages that repeat the query's common words ("power", "charge")
  // above the table — the SAME failure mode the PF525 measurement program
  // documented (BM25 OR-fanout rewards token repetition; fault-history tables
  // outrank procedure text), reproduced on a 100-chunk consumer manual. Note
  // "battery voltage specifications" (a query naming the table's own header)
  // retrieves p.15 at rank 1 — the content is reachable; the lexical bridge is
  // what's missing. The repair is Phase 2's table-aware extraction (chunk table
  // rows WITH their header context), NOT a query-side hack — per the standing
  // "measure the verbatim-quote ceiling before any query-side fix" law.
  //
  // knownMiss entries use it.fails: they FLIP RED the day the miss is fixed, so
  // the marker must then be removed (strict-xfail discipline, no silent drift).
  const GOLDEN: Array<{ q: string; markers: string[]; knownMiss?: string }> = [
    { q: "What exact product is this?", markers: ["T2108"] },
    {
      q: "What input power does the RoboVac require?",
      markers: ["19", "0.6"],
      knownMiss: "spec-table row (p.15) lexically disjoint from the question",
    },
    {
      q: "What battery does it use?",
      markers: ["14.4", "2600"],
      knownMiss: "spec-table row (p.15) lexically disjoint from the question",
    },
    {
      q: "How long can it clean and how long does charging take?",
      markers: ["100 min"],
      knownMiss: "spec-table row (p.15) lexically disjoint from the question",
    },
    { q: "How do I clean the rolling brush?", markers: ["rolling brush"] },
    { q: "What should I check if the RoboVac cannot be activated?", markers: ["activated"] },
  ];

  for (const { q, markers, knownMiss } of GOLDEN) {
    const run = knownMiss ? it.fails : it;
    const label = knownMiss
      ? `golden [KNOWN MISS — ${knownMiss}]: "${q}"`
      : `golden: "${q}" → top-K contains ${JSON.stringify(markers)}`;
    run(label, async () => {
      const chunks = await ask(q, T2108_DOC);
      expect(chunks.length).toBeGreaterThan(0);
      expect(
        hasAll(chunks, markers),
        `markers ${JSON.stringify(markers)} missing from top-${chunks.length}:\n` +
          chunks.map((c) => `p.${c.sourcePage}: ${c.content.slice(0, 80)}`).join("\n"),
      ).toBe(true);
    });
  }

  it("cites the real page for the specifications", async () => {
    const chunks = await ask("battery voltage specifications", T2108_DOC);
    const spec = chunks.find((c) => c.content.includes("14.4"));
    expect(spec).toBeDefined();
    expect(spec!.sourcePage).toBe(15); // Specifications is PDF page 15
    expect(spec!.title).toBe("T2108_Manual_EN.pdf");
  });

  // ── Gate F: document scope is a hard boundary ─────────────────────────────
  it("gate F: a T2108-scoped ask NEVER returns sibling-document chunks", async () => {
    // This query is tuned for the DECOY (GS10 fault codes) parked on the SAME node.
    const chunks = await ask("What does GS10 fault code oC mean?", T2108_DOC);
    for (const c of chunks) {
      expect(c.title).toBe("T2108_Manual_EN.pdf");
      expect(c.sourceUrl).toContain(T2108_DOC);
    }
    // And unscoped (node-level) retrieval DOES see the decoy — proving the
    // boundary is the docId, not an accident of the corpus.
    const nodeWide = await withClient((c) =>
      retrieveNodeChunks(c, TENANT, "What does GS10 fault code oC mean?", {
        nodeId: NODE,
        unsPath: null,
      }),
    );
    expect(nodeWide.some((c) => c.sourceUrl.includes(DECOY_DOC))).toBe(true);
  });

  it("zero-text honesty holds against the real DB (nothing inserted)", async () => {
    await expect(
      writeTextChunksForNode({
        tenantId: TENANT,
        uploadId: randomUUID(),
        nodeId: NODE,
        unsPath: null,
        filename: "empty.md",
        buffer: Buffer.from("   \n  "),
      }),
    ).rejects.toBeInstanceOf(NoExtractableTextError);
  });
});

if (!READY) {
  describe("T2108 integration (env not provisioned)", () => {
    it.skip("set TEST_DATABASE_URL + MIRA_TEST_DB_CONFIRM=DISPOSABLE + T2108_PDF_PATH", () => {});
  });
}
