// Phase 1.5 bake-off — FactoryLM baseline lane (#3185 REAL code, immutable
// reference). Ingests the bake-off fixtures through writePdfChunksForNode and
// answers every benchmark question through retrieveNodeChunks with docId scope,
// emitting the same QResult JSONL schema as the python lanes. NOT a quality
// gate: it measures; it never asserts benchmark scores (the only hard
// assertions are harness-integrity ones).
//
// Env (all required to run, otherwise the suite skips):
//   TEST_DATABASE_URL       disposable postgres (pgvector image)
//   MIRA_TEST_DB_CONFIRM    DISPOSABLE
//   BAKEOFF_DIR             absolute path to experiments/doc-intel-bakeoff
// Run:
//   npx vitest run --config vitest.integration.config.ts src/lib/__tests__/bakeoff-factorylm.integration.test.ts

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const BAKEOFF_DIR = process.env.BAKEOFF_DIR ?? "";
const READY = Boolean(
  process.env.TEST_DATABASE_URL &&
    process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" &&
    BAKEOFF_DIR &&
    fs.existsSync(path.join(BAKEOFF_DIR, "out", "questions.json")),
);

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
  };
});

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (_tenantId: string, fn: (c: PoolClient) => Promise<unknown>) => {
    const c = await testPool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  },
}));

import { writePdfChunksForNode, NoExtractableTextError } from "../node-knowledge-ingest";
import { retrieveNodeChunks } from "../manual-rag";

interface BQuestion {
  id: string;
  class: string;
  doc: string;
  q: string;
  expect_all?: string[];
  expect_any?: string[];
  expect_page?: number;
  abstain?: boolean;
  scope_guard?: boolean;
}

const TENANT = randomUUID();
const NODE = randomUUID();

const hubRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(hubRoot, "..");

async function applySchema(): Promise<void> {
  await testPool.query("CREATE EXTENSION IF NOT EXISTS vector");
  for (const f of [
    path.join(repoRoot, "docs", "migrations", "001_knowledge_entries.sql"),
    path.join(hubRoot, "db", "migrations", "045_knowledge_entries_chunk_anchors.sql"),
  ]) {
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

describe.skipIf(!READY)("bake-off: factorylm-baseline lane", () => {
  const docIds = new Map<string, string>(); // doc key → doc_id (uploadId)
  const shas = new Map<string, string>();
  const ingestErrors = new Map<string, string>();
  let docsMeta: Record<string, { file: string }> = {};
  let questions: BQuestion[] = [];

  beforeAll(async () => {
    const spec = JSON.parse(
      fs.readFileSync(path.join(BAKEOFF_DIR, "out", "questions.json"), "utf8"),
    ) as { docs: Record<string, { file: string }>; questions: BQuestion[] };
    docsMeta = spec.docs;
    questions = spec.questions;

    await applySchema();
    await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);

    for (const key of Object.keys(docsMeta)) {
      const pdfPath = path.join(BAKEOFF_DIR, docsMeta[key].file);
      const buffer = fs.readFileSync(pdfPath);
      shas.set(key, createHash("sha256").update(buffer).digest("hex"));
      const uploadId = randomUUID();
      docIds.set(key, uploadId);
      try {
        await writePdfChunksForNode({
          tenantId: TENANT,
          uploadId,
          nodeId: NODE,
          unsPath: null,
          filename: path.basename(pdfPath),
          buffer,
        });
      } catch (err) {
        if (err instanceof NoExtractableTextError) {
          // The honest #3185 behavior for scanned docs — recorded per-question.
          ingestErrors.set(key, "NoExtractableTextError");
        } else {
          throw err;
        }
      }
    }
  }, 300_000);

  afterAll(async () => {
    await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);
    await testPool.end();
  });

  it("answers every benchmark question through the real #3185 retrieval and writes JSONL", async () => {
    const rows: string[] = [];
    for (const q of questions) {
      const t0 = Date.now();
      let evidence: Array<{ doc_id: string; page: number | null; kind: string; snippet: string }> = [];
      let error: string | null = null;
      if (ingestErrors.has(q.doc)) {
        error = `ingest: ${ingestErrors.get(q.doc)}`;
      } else {
        const client = await testPool.connect();
        try {
          const chunks = await retrieveNodeChunks(client, TENANT, q.q, {
            nodeId: NODE,
            unsPath: null,
            docId: docIds.get(q.doc)!,
          });
          evidence = chunks.map((c) => ({
            doc_id: q.doc,
            page: c.sourcePage,
            kind: "text",
            snippet: c.content.slice(0, 600),
          }));
        } finally {
          client.release();
        }
      }
      const latency = (Date.now() - t0) / 1000;

      // Deterministic scoring — mirror of common.py::score for retrieval lanes.
      const hay = evidence.map((e) => e.snippet).join("\n").toLowerCase();
      const hasAll = (m: string[]) => m.every((x) => hay.includes(x.toLowerCase()));
      const hasAny = (m: string[]) => m.some((x) => hay.includes(x.toLowerCase()));
      const abstained = evidence.length === 0;
      let correct: boolean;
      let abstentionCorrect: boolean | null = null;
      let citationCorrect: boolean | null = null;
      if (q.abstain) {
        abstentionCorrect = abstained;
        correct = abstained;
      } else {
        correct =
          (!q.expect_all || hasAll(q.expect_all)) &&
          (!q.expect_any || hasAny(q.expect_any));
        if (q.expect_page != null) {
          citationCorrect = evidence.some((e) => e.page === q.expect_page);
        }
      }
      const scopeOk = q.scope_guard ? evidence.every((e) => e.doc_id === q.doc) : null;

      rows.push(
        JSON.stringify({
          run_id: "r1",
          adapter: "factorylm-baseline",
          adapter_kind: "retrieval",
          backend: "pg-tsvector-#3185",
          versions: { code: "PR#3185 retrieveNodeChunks+writePdfChunksForNode", chunker: "node-ingest 1000/120" },
          doc_id: q.doc,
          doc_sha256: shas.get(q.doc),
          question_id: q.id,
          question_class: q.class,
          question: q.q,
          expected: {
            expect_all: q.expect_all ?? null,
            expect_any: q.expect_any ?? null,
            expect_page: q.expect_page ?? null,
            abstain: q.abstain ?? null,
          },
          answer_text: "",
          evidence,
          cited_pages: [],
          abstained,
          correct,
          citation_correct: citationCorrect,
          abstention_correct: abstentionCorrect,
          scope_ok: scopeOk,
          latency_s: latency,
          cost_usd: 0,
          tokens: null,
          error,
          ts: new Date().toISOString(),
        }),
      );
    }
    const outPath = path.join(BAKEOFF_DIR, "out", "results.jsonl");
    fs.appendFileSync(outPath, rows.join("\n") + "\n");
    // Harness integrity only — never a benchmark-score assertion.
    expect(rows.length).toBe(questions.length);
  }, 300_000);
});

if (!READY) {
  describe("bake-off baseline (env not provisioned)", () => {
    it.skip("set TEST_DATABASE_URL + MIRA_TEST_DB_CONFIRM=DISPOSABLE + BAKEOFF_DIR", () => {});
  });
}
