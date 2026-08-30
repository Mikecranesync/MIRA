// Workstream A — coherent private-source retrieval admission (#3437 / #3468).
// PRD: docs/prd/2026-08-29-technician-beta-recovery-prd.md §7.2 / §7.4.
//
// Requires a disposable Postgres. From the repo root (bash):
//
//   docker run -d --name mira-wsa-pg -e POSTGRES_PASSWORD=testpw \
//     -e POSTGRES_DB=mira_test -p 5601:5432 postgres:16
//   export TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:5601/mira_test"
//   export MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   export MIRA_INTEGRATION_MIGRATIONS="001_knowledge_graph.sql,010_kg_uns_path.sql,\
//     026_kg_entities_dedupe_and_constraint.sql,027_ai_suggestions.sql,\
//     029_kg_approval_state.sql,055_contextualization.sql,\
//     056_contextualization_intake.sql,067_ctx_import_batches_approval_cols.sql,\
//     027_namespace_direct_uploads.sql,059_namespace_filing_cabinet.sql,\
//     068_hub_uploads.sql,072_hub_uploads_content_sha256.sql,\
//     073_equipment_notebooks.sql,075_workspace_file_links.sql,\
//     076_namespace_uploads_source_reconcile.sql,077_ingest_claim.sql,\
//     082_namespace_uploads_node_nullable.sql,084_notebook_turn_basis_and_source_origin.sql,\
//     085_notebook_source_canonical_provenance.sql"
//   (cd mira-hub && node scripts/setup-integration-db.mjs)
//   (cd mira-hub && npx vitest run --config vitest.integration.config.ts \
//      src/lib/__tests__/approved-source-admission)
//
// WHY INTEGRATION: the defect is a SQL predicate. Under
// MIRA_ENFORCE_APPROVED_RETRIEVAL=true, retrieveNodeChunks appends
// `AND verified = true` to every v2 chunk read, but the v2 upload writer never
// sets knowledge_entries.verified and the notebook confirmation lives in
// equipment_notebook_sources.match_state — so a tenant's explicitly confirmed
// private manual returns zero rows and Gate G abstains (#3437), including every
// source confirmed before #3440 (#3468). A mocked client can assert SQL text; it
// cannot prove that verified=false rows are admitted ONLY through the
// server-derived confirmed set while every deny case stays denied.
//
// Every case below runs the same two-step the chat route runs:
//   validateChatSources(tenant, notebook, requestedIds)   -- server authority
//   retrieveNodeChunks(..., { docIds, approvedSourceDocIds }) -- SQL boundary
// so client-supplied ids are an intersection request, never authority (§6.4).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { validateChatSources } from "../equipment-notebooks";
import { retrieveNodeChunks } from "../manual-rag";

const TENANT = "a7000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "a7000000-0000-4000-8000-0000000000ff";
const SYSTEM_TENANT = "a7000000-0000-4000-8000-00000000005e"; // shared OEM corpus owner
const NODE = "a7000000-0000-4000-8000-00000000000e";
const NB = "a7000000-3333-4000-8000-000000000031";

// Case 1..4 — admissible after the fix (confirmed, enabled, tenant-owned, verified=false chunks)
const DOC_PDF = "a7000000-2222-4000-8000-000000000001";
const DOC_TXT = "a7000000-2222-4000-8000-000000000002";
const DOC_OCR = "a7000000-2222-4000-8000-000000000003";
const DOC_PREFIX = "a7000000-2222-4000-8000-000000000004"; // confirmed before #3440
// Case 5..9 — must stay excluded
const DOC_SHARED = "a7000000-2222-4000-8000-000000000005"; // is_private=false, verified=false
const DOC_CAND = "a7000000-2222-4000-8000-000000000006"; // match_state='candidate'
const DOC_DISABLED = "a7000000-2222-4000-8000-000000000007"; // enabled_by_default=false
const DOC_FORGED = "a7000000-2222-4000-8000-000000000009"; // tenant chunk, never linked to NB

// One shared sentinel word so a single query hits EVERY seeded chunk; per-doc
// tokens make attribution unambiguous.
const SENTINEL = "qzsentinel";
const QUERY = `${SENTINEL} belt tension`;

type Chunk = { doc: string; tenant: string; content: string; isPrivate: boolean; verified?: boolean; sourceType?: string };

const CHUNKS: Chunk[] = [
  { doc: DOC_PDF, tenant: TENANT, content: `${SENTINEL} pdfdoc belt tension is 42 newtons`, isPrivate: true },
  { doc: DOC_TXT, tenant: TENANT, content: `${SENTINEL} txtdoc belt tension is 43 newtons`, isPrivate: true },
  { doc: DOC_OCR, tenant: TENANT, content: `${SENTINEL} ocrdoc nameplate FLA 12A belt tension`, isPrivate: true, sourceType: "nameplate_text" },
  { doc: DOC_PREFIX, tenant: TENANT, content: `${SENTINEL} prefixdoc belt tension is 44 newtons`, isPrivate: true },
  { doc: DOC_SHARED, tenant: TENANT, content: `${SENTINEL} shareddoc belt tension is 45 newtons`, isPrivate: false },
  { doc: DOC_SHARED, tenant: SYSTEM_TENANT, content: `${SENTINEL} oemdoc belt tension is 46 newtons`, isPrivate: false },
  { doc: DOC_CAND, tenant: TENANT, content: `${SENTINEL} canddoc belt tension is 47 newtons`, isPrivate: true },
  { doc: DOC_DISABLED, tenant: TENANT, content: `${SENTINEL} disableddoc belt tension is 48 newtons`, isPrivate: true },
  { doc: DOC_FORGED, tenant: TENANT, content: `${SENTINEL} forgeddoc belt tension is 49 newtons`, isPrivate: true },
];

async function ensureChunkColumns() {
  // The hub integration fixture creates knowledge_entries without the v2 chunk
  // columns (they live in docs/migrations + production drift). Additive stubs
  // mirroring the prod columns retrieveNodeChunks reads; content_tsv is the
  // GENERATED tsvector the BM25 lane matches on.
  await testPool.query(
    `ALTER TABLE knowledge_entries
       ADD COLUMN IF NOT EXISTS doc_id uuid,
       ADD COLUMN IF NOT EXISTS ingest_route text,
       ADD COLUMN IF NOT EXISTS page_start integer,
       ADD COLUMN IF NOT EXISTS page_end integer,
       ADD COLUMN IF NOT EXISTS section_path text`,
  );
  await testPool.query(
    `ALTER TABLE knowledge_entries
       ADD COLUMN IF NOT EXISTS content_tsv tsvector
         GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`,
  );
}

async function seed() {
  const c = testPool;
  await c.query(
    `INSERT INTO equipment_notebooks (id, tenant_id, display_name, node_id)
     VALUES ($1::uuid, $2::uuid, 'Northstar CV-42 (wsa itest)', $3::uuid)`,
    [NB, TENANT, NODE],
  );
  // Relationship rows — the ONLY place confirmation lives.
  const sources: Array<[string, string, boolean, string | null, string]> = [
    [DOC_PDF, "user_confirmed", true, "manual", "now() - interval '1 minute'"],
    [DOC_TXT, "user_confirmed", true, "note", "now() - interval '1 minute'"],
    [DOC_OCR, "user_confirmed", true, "photo", "now() - interval '1 minute'"],
    // #3468 shape: confirmed long before #3440 shipped; chunks never marked.
    [DOC_PREFIX, "verified", true, "manual", "now() - interval '30 days'"],
    [DOC_SHARED, "user_confirmed", true, "manual", "now() - interval '1 minute'"],
    [DOC_CAND, "candidate", true, "manual", "now() - interval '1 minute'"],
    [DOC_DISABLED, "user_confirmed", false, "manual", "now() - interval '1 minute'"],
  ];
  for (const [doc, state, enabled, role, createdAt] of sources) {
    await c.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, source_role, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, ${createdAt})`,
      [NB, doc, TENANT, enabled, state, role],
    );
  }
  for (const ch of CHUNKS) {
    await c.query(
      `INSERT INTO knowledge_entries
         (tenant_id, doc_id, content, source_type, source_url, source_page, page_start,
          ingest_route, metadata, is_private, verified)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 1, 1, 'v2',
               jsonb_build_object('node_id', $6::text, 'filename', $7::text, 'chunk_index', 0),
               $8, $9)`,
      [
        ch.tenant,
        ch.doc,
        ch.content,
        ch.sourceType ?? "node_attachment",
        `node-doc/${ch.doc}/file.pdf`,
        NODE,
        `file-${ch.doc.slice(-4)}.pdf`,
        ch.isPrivate,
        ch.verified ?? false,
      ],
    );
  }
}

async function cleanup() {
  const c = testPool;
  await c.query(`DELETE FROM equipment_notebook_sources WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM equipment_notebooks WHERE tenant_id = $1::uuid`, [TENANT]);
  await c.query(`DELETE FROM knowledge_entries WHERE tenant_id = ANY($1::uuid[])`, [
    [TENANT, OTHER_TENANT, SYSTEM_TENANT],
  ]);
}

/** The route's retrieval call shape (chat/route.ts), against the raw pool. */
async function retrieve(
  tenantId: string,
  opts: { docIds: string[]; approvedSourceDocIds?: string[] },
): Promise<string[]> {
  const client: PoolClient = await testPool.connect();
  try {
    const chunks = await retrieveNodeChunks(client, tenantId, QUERY, {
      nodeId: NODE,
      unsPath: null,
      topK: 12,
      docIds: opts.docIds,
      rawQuery: QUERY,
      validatedDocScope: true,
      approvedSourceDocIds: opts.approvedSourceDocIds,
    });
    return [...new Set(chunks.map((c) => String(c.docId)))].sort();
  } finally {
    client.release();
  }
}

/** validateChatSources (server authority) → retrieval with the DERIVED set. */
async function askAsNotebook(tenantId: string, requested: string[]) {
  const validated = await validateChatSources(tenantId, NB, requested);
  if (!validated.ok) return { validated, docIds: [] as string[] };
  const docIds = await retrieve(tenantId, {
    docIds: validated.docIds,
    approvedSourceDocIds: validated.docIds,
  });
  return { validated, docIds };
}

async function verifiedCount(tenantId: string): Promise<number> {
  const r = await testPool.query(
    `SELECT count(*)::int AS n FROM knowledge_entries WHERE tenant_id = $1::uuid AND verified = true`,
    [tenantId],
  );
  return r.rows[0].n as number;
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required — see the header recipe.");
  }
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Refusing to run against a non-disposable database.");
  }
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true"; // production-equivalent gate
  await ensureChunkColumns();
  await cleanup();
  await seed();
});

afterAll(async () => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  await cleanup();
  await testPool.end();
});

describe("Workstream A §7.4 — admitted through the server-derived confirmed set (gate ON)", () => {
  it("1. fresh tenant-private PDF upload, confirmed and selected → retrievable", async () => {
    const { validated, docIds } = await askAsNotebook(TENANT, [DOC_PDF]);
    expect(validated.ok).toBe(true);
    expect(docIds).toEqual([DOC_PDF]);
  });

  it("2. fresh tenant-private text upload, confirmed and selected → retrievable", async () => {
    const { docIds } = await askAsNotebook(TENANT, [DOC_TXT]);
    expect(docIds).toEqual([DOC_TXT]);
  });

  it("3. confirmed OCR/nameplate-derived document → retrievable without relying on a verified mark", async () => {
    const { docIds } = await askAsNotebook(TENANT, [DOC_OCR]);
    expect(docIds).toEqual([DOC_OCR]);
  });

  it("4. #3468: source confirmed pre-fix with knowledge_entries.verified=false → retrievable with NO data rewrite", async () => {
    expect(await verifiedCount(TENANT)).toBe(0);
    const { docIds } = await askAsNotebook(TENANT, [DOC_PREFIX]);
    expect(docIds).toEqual([DOC_PREFIX]);
    // The corrected query admits the historical row; nothing was mutated (§7.3).
    expect(await verifiedCount(TENANT)).toBe(0);
  });
});

describe("Workstream A §7.4 — still excluded (fail-closed)", () => {
  it("5. shared (is_private=false) source with verified=false stays excluded, even when confirmed in a notebook", async () => {
    const { validated, docIds } = await askAsNotebook(TENANT, [DOC_SHARED]);
    // The relationship exists, so the server admits the ID …
    expect(validated.ok).toBe(true);
    // … but shared-corpus rows (the tenant's own is_private=false row AND the
    // system-tenant OEM row) stay under the global verification rule.
    expect(docIds).toEqual([]);
  });

  it("6. private candidate source stays excluded (server refuses; retrieval never admits it via the approved set)", async () => {
    const { validated } = await askAsNotebook(TENANT, [DOC_CAND]);
    expect(validated).toEqual({ ok: false, error: "source_not_in_notebook" });
    // Even if a caller narrowed docIds to include it, only the DERIVED set admits.
    const docIds = await retrieve(TENANT, {
      docIds: [DOC_PDF, DOC_CAND],
      approvedSourceDocIds: [DOC_PDF],
    });
    expect(docIds).toEqual([DOC_PDF]);
  });

  it("7. private disabled source stays excluded", async () => {
    const { validated } = await askAsNotebook(TENANT, [DOC_DISABLED]);
    expect(validated).toEqual({ ok: false, error: "source_not_in_notebook" });
    const docIds = await retrieve(TENANT, {
      docIds: [DOC_PDF, DOC_DISABLED],
      approvedSourceDocIds: [DOC_PDF],
    });
    expect(docIds).toEqual([DOC_PDF]);
  });

  it("8. the same document ID requested from another tenant stays excluded", async () => {
    const { validated } = await askAsNotebook(OTHER_TENANT, [DOC_PDF]);
    expect(validated).toEqual({ ok: false, error: "notebook_not_found" });
    // Retrieval-layer defence in depth: a forged approved set under the wrong
    // tenant admits nothing — tenant ownership is a SQL predicate on the chunk.
    const docIds = await retrieve(OTHER_TENANT, {
      docIds: [DOC_PDF],
      approvedSourceDocIds: [DOC_PDF],
    });
    expect(docIds).toEqual([]);
  });

  it("9. a forged client source ID not linked to the notebook stays excluded", async () => {
    const { validated } = await askAsNotebook(TENANT, [DOC_PDF, DOC_FORGED]);
    expect(validated).toEqual({ ok: false, error: "source_not_in_notebook" });
    // And at the SQL boundary an approved id outside the validated doc scope is
    // intersected away — the approved set can narrow, never widen.
    const docIds = await retrieve(TENANT, {
      docIds: [DOC_PDF],
      approvedSourceDocIds: [DOC_PDF, DOC_FORGED],
    });
    expect(docIds).toEqual([DOC_PDF]);
  });

  it("no approved set ⇒ the pre-existing global rule (verified=true only) — the NodeChat/legacy shape is unchanged", async () => {
    const docIds = await retrieve(TENANT, { docIds: [DOC_PDF, DOC_TXT] });
    expect(docIds).toEqual([]);
  });
});
