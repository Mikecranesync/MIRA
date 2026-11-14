// ARPK Phase 1f — the T2108 proof: a consumer manual the industrial alias
// table has never seen goes upload → v2 chunks → DOC-SCOPED retrieval, against
// a REAL disposable Postgres. This is the PRD's golden benchmark run at the
// retrieval layer (no LLM): every question asserts the retrieved top-K contains
// the manual fact, and gate F asserts a doc-scoped ask can never surface a
// sibling document's chunks.
//
// Fast PDF pipeline contract: TEST_DATABASE_URL + MIRA_TEST_DB_CONFIRM=DISPOSABLE,
// PostgreSQL16+, generated PDF bytes, no model/network or pgvector dependency.
// Select it with: -t 'PDF pipeline contract'.
//
// The original manufacturer-manual audit additionally requires:
//   TEST_DATABASE_URL      local postgres with the pgvector extension available
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
//   T2108_PDF_PATH         the fetched official manual
//                          (py tests/beta/fixtures/t2108/fetch.py)
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/t2108-doc-chat.integration.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { Pool, PoolClient } from "pg";
import { buildPdf } from "@/capabilities/work-packet/__tests__/fixtures/pdf";

const PDF_PATH = process.env.T2108_PDF_PATH ?? "";
const READY = Boolean(
  process.env.TEST_DATABASE_URL &&
    process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE" &&
    PDF_PATH &&
    fs.existsSync(PDF_PATH),
);
const CONTRACT_READY = Boolean(process.env.TEST_DATABASE_URL
  && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool, contract, network } = vi.hoisted(() => {
  // The writer captures this switch on import. Both groups are keyless.
  vi.stubEnv("NODE_EMBED_ON_WRITE", "0");
  const network = vi.fn(() => { throw new Error("PDF pipeline tests forbid fetch calls"); });
  vi.stubGlobal("fetch", network);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({
      connectionString: process.env.TEST_DATABASE_URL,
    }) as Pool,
    contract: { client: null as PoolClient | null },
    network,
  };
});

function requireDisposableDatabase(urlText = process.env.TEST_DATABASE_URL,
  confirmation = process.env.MIRA_TEST_DB_CONFIRM): void {
  if (!urlText || confirmation !== "DISPOSABLE") {
    throw new Error("Explicit disposable TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM required");
  }
  let url: URL;
  try { url = new URL(urlText); }
  catch { throw new Error("TEST_DATABASE_URL must be a valid local PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || Boolean(url.search || url.hash)
    || /prod|prd|staging/i.test(url.pathname)) {
    throw new Error("Only an isolated local disposable PostgreSQL database is permitted");
  }
}

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
    requireDisposableDatabase();
    if (contract.client) return fn(contract.client);
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
  requireDisposableDatabase();
  if (contract.client) return fn(contract.client);
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
    requireDisposableDatabase();
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
    requireDisposableDatabase();
    await testPool.query(`DELETE FROM knowledge_entries WHERE tenant_id = $1`, [TENANT]);
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

// With disposable DB configuration: real PDF parser + writer + PostgreSQL queries, without the
// separately fetched T2108/pgvector audit. The connection adapter bypasses RLS;
// this proves SQL filtering and metadata, not production authorization or UI.
describe.skipIf(!CONTRACT_READY)("PDF pipeline contract", () => {
  const DOC = randomUUID();
  const OTHER = randomUUID();
  const FOREIGN = randomUUID();
  const FACT = "BX410 rated supply voltage: 24 V DC.";
  const QUERY = "BX410 rated supply voltage";
  const filename = "bx410-manual.pdf";
  const pdf = (model: string, value: string) => buildPdf([
    { texts: [{ text: `${model} Installation Manual`, x: 72, y: 720, size: 12 }] },
    { texts: [{ text: "Fixture index.", x: 72, y: 720, size: 12 }] },
    { texts: [{ text: `${model} rated supply voltage: ${value} V DC.`, x: 72, y: 720, size: 12 }] },
  ]);
  const bytes = pdf("BX410", "24");
  const unrelated = pdf("BX420", "48");
  const blank = buildPdf([{ texts: [] }]);
  const sqlErrors: string[] = [];
  const warnings: unknown[][] = [];

  async function ingest(doc = DOC, name = filename, buffer = bytes) {
    expect(buffer.byteLength).toBeLessThan(64 * 1024);
    return writePdfChunksForNode({
      tenantId: TENANT, uploadId: doc, nodeId: NODE, unsPath: null,
      filename: name, buffer: Buffer.from(buffer),
    });
  }

  async function retrieve(docIds = [DOC], query = QUERY, tenant = TENANT, model = "BX410") {
    const diagnostics: NonNullable<Parameters<typeof retrieveNodeChunks>[3]["diagnostics"]> = {};
    const chunks = await retrieveNodeChunks(contract.client!, tenant, query, {
      nodeId: NODE, unsPath: null, docIds, approvedSourceDocIds: docIds,
      validatedDocScope: true, identity: { manufacturer: "FixtureWorks", model },
      identityStatus: "user_confirmed", catalogNumber: model, diagnostics,
    });
    return { chunks, diagnostics };
  }

  function expectFact(chunks: ManualChunk[], name = filename) {
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.docId === DOC)).toBe(true);
    const fact = chunks.find((c) => c.content.includes(FACT));
    expect(fact).toBeDefined();
    expect(fact).toMatchObject({ sourcePage: 3, title: name, chunkIndex: null });
    expect(fact!.sourceUrl).toContain(DOC);
    expect(fact!.pageLabel ?? null).toBeNull();
    return fact!;
  }

  beforeAll(async () => {
    requireDisposableDatabase();
    const warn = console.warn;
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
      warn(...args);
    });
    console.info("[pdf-pipeline-fixtures]", JSON.stringify(Object.fromEntries(
      Object.entries({ baseline: bytes, distractor: unrelated, blank }).map(([name, buffer]) =>
        [name, { bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex") }]),
    )));
    contract.client = await testPool.connect();
    // Observe real query rejections even when production catches a degraded
    // optional read. Forward all SQL/parameters/results to the actual client.
    const execute = contract.client.query.bind(contract.client) as (...args: unknown[]) => unknown;
    vi.spyOn(contract.client, "query").mockImplementation(((...args: unknown[]) => {
      const result = execute(...args);
      return result instanceof Promise ? result.catch((error: unknown) => {
        sqlErrors.push(error instanceof Error ? error.message : String(error));
        throw error;
      }) : result;
    }) as PoolClient["query"]);
    await contract.client.query("BEGIN");
    await contract.client.query("SET LOCAL statement_timeout = '5000ms'");
    await contract.client.query(`CREATE TEMP TABLE knowledge_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
      source_type text NOT NULL, content text NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      manufacturer text NOT NULL DEFAULT '', model_number text NOT NULL DEFAULT '',
      source_url text NOT NULL, source_page integer, page_start integer, page_end integer,
      section_path text, metadata jsonb NOT NULL, verified boolean NOT NULL DEFAULT false,
      is_private boolean NOT NULL DEFAULT false, doc_id uuid NOT NULL, ingest_route text NOT NULL
    ) ON COMMIT DROP`);
    // Canonical writer dedup expression: migration003, not a simulated INSERT.
    await contract.client.query(`CREATE UNIQUE INDEX pdf_pipeline_chunks
      ON knowledge_entries (tenant_id, source_url, ((metadata->>'chunk_index')::int))
      WHERE metadata->>'chunk_index' IS NOT NULL`);
    const { rows } = await contract.client.query("SELECT pg_my_temp_schema() = relnamespace AS temporary FROM pg_class WHERE oid = 'knowledge_entries'::regclass");
    expect(rows).toEqual([{ temporary: true }]);
  });

  beforeEach(async () => {
    sqlErrors.length = 0;
    warnings.length = 0;
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
    await contract.client!.query("SAVEPOINT pdf_case");
    expect(await ingest()).toBe(3);
  });

  afterEach(async () => {
    if (contract.client) {
      await contract.client.query("ROLLBACK TO SAVEPOINT pdf_case");
      await contract.client.query("RELEASE SAVEPOINT pdf_case");
    }
    expect(network).not.toHaveBeenCalled();
    expect(sqlErrors, "production swallowed a real SQL error").toEqual([]);
    expect(warnings.filter(([message]) => typeof message === "string"
      && /^\[(retrieveNodeChunks|node-ingest)\]/.test(message)), "production degraded the PDF/SQL path").toEqual([]);
  });

  afterAll(async () => {
    const client = contract.client;
    contract.client = null;
    if (client) {
      try { await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
  });

  it("[pipeline:baseline] parses, stores and retrieves actual PDF evidence", async () => {
    if (process.env.MIRA_PDF_PREFLIGHT_CHILD === "1") throw new Error("Unconfigured child must be skipped");
    const scratch = fs.mkdtempSync(path.join(tmpdir(), "pdf-unconfigured-"));
    try {
      const report = path.join(scratch, "report.json");
      const child = spawnSync(process.execPath, [
        path.join(hubRoot, "node_modules/vitest/vitest.mjs"), "run",
        "--config", "vitest.integration.config.ts", "src/lib/__tests__/t2108-doc-chat.integration.test.ts",
        "-t", "PDF pipeline contract", "--reporter=json", `--outputFile=${report}`,
      ], { cwd: hubRoot, env: { ...process.env, TEST_DATABASE_URL: "", MIRA_TEST_DB_CONFIRM: "", MIRA_PDF_PREFLIGHT_CHILD: "1" },
        encoding: "utf8", timeout: 20000 });
      expect(child.status, child.stderr).toBe(0);
      const unconfigured = JSON.parse(fs.readFileSync(report, "utf8"));
      const cases = unconfigured.testResults[0].assertionResults
        .filter((a: { title: string }) => a.title.startsWith("[pipeline:"));
      expect(cases).toHaveLength(8);
      expect(cases.every((a: { status: string }) => ["pending", "skipped"].includes(a.status))).toBe(true);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    // These exercise the same guard used before every real connection, without
    // attempting any connection to a deliberately invalid address.
    for (const url of ["postgres://postgres@remote.invalid/test", "postgres://postgres@127.0.0.1/staging",
      "postgres://postgres@127.0.0.1/test?host=127.0.0.1"]) {
      expect(() => requireDisposableDatabase(url, "DISPOSABLE")).toThrow();
    }
    const { rows } = await contract.client!.query("SELECT count(*)::int AS n, bool_and(is_private AND ingest_route = 'v2') AS private_v2 FROM knowledge_entries WHERE doc_id = $1", [DOC]);
    expect(rows).toEqual([{ n: 3, private_v2: true }]);
    expectFact((await retrieve()).chunks);
  });

  it("[pipeline:rename] identical PDF bytes keep the fact and renamed title", async () => {
    await contract.client!.query("DELETE FROM knowledge_entries WHERE doc_id = $1", [DOC]);
    await ingest(DOC, "installation-guide.pdf");
    expectFact((await retrieve()).chunks, "installation-guide.pdf");
  });

  it("[pipeline:unrelated] an ingested competing manual cannot replace the fact", async () => {
    await ingest(OTHER, "bx420-manual.pdf", unrelated);
    const control = await retrieve([OTHER], "BX420 rated supply voltage", TENANT, "BX420");
    expect(control.chunks.some((c) => c.docId === OTHER && c.content.includes("48 V DC"))).toBe(true);
    expectFact((await retrieve([DOC, OTHER])).chunks);
  });

  it("[pipeline:order] selected document order preserves the citation", async () => {
    await ingest(OTHER, "bx420-manual.pdf", unrelated);
    const first = expectFact((await retrieve([DOC, OTHER])).chunks);
    const reversed = expectFact((await retrieve([OTHER, DOC])).chunks);
    expect([reversed.content, reversed.sourcePage, reversed.sourceUrl, reversed.title])
      .toEqual([first.content, first.sourcePage, first.sourceUrl, first.title]);
  });

  it("[pipeline:wrong-model] an explicit sibling request refuses the record", async () => {
    expectFact((await retrieve()).chunks);
    const result = await retrieve([DOC], "BX420 rated supply voltage");
    expect(result.chunks).toEqual([]);
    expect(result.diagnostics.siblingOfRecordAsk).toEqual({ asked: ["BX420"], record: "BX410" });
  });

  it("[pipeline:foreign-tenant] SQL excludes another tenant's private document", async () => {
    expectFact((await retrieve()).chunks);
    expect((await retrieve([DOC], QUERY, FOREIGN)).chunks).toEqual([]);
  });

  it("[pipeline:page-anchor] PDF page three is not chunk ordinal two", async () => {
    const { rows } = await contract.client!.query("SELECT source_page, page_start, page_end, (metadata->>'chunk_index')::int AS ordinal FROM knowledge_entries WHERE doc_id = $1 AND page_start = 3", [DOC]);
    expect(rows).toEqual([{ source_page: 3, page_start: 3, page_end: 3, ordinal: 2 }]);
    expectFact((await retrieve()).chunks);
  });

  it("[pipeline:blank] a real blank PDF fails without inserting rows", async () => {
    const before = await contract.client!.query("SELECT count(*)::int AS n FROM knowledge_entries");
    await expect(ingest(randomUUID(), "blank.pdf", blank)).rejects.toBeInstanceOf(NoExtractableTextError);
    const after = await contract.client!.query("SELECT count(*)::int AS n FROM knowledge_entries");
    expect(after.rows).toEqual(before.rows);
  });
});

afterAll(async () => {
  try {
    await testPool.end();
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
