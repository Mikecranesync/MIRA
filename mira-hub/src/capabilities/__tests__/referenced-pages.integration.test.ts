// #6030 F2/F3 — the referenced-page read against a REAL Postgres, not a SQL-text mock.
//
// Requires an explicitly owned disposable database (the launcher's synthetic loopback DB):
//   TEST_DATABASE_URL=<disposable> MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   (cd mira-hub && node scripts/setup-integration-db.mjs)
//   (cd mira-hub && npx vitest run --config vitest.integration.config.ts \
//      src/capabilities/__tests__/referenced-pages.integration.test.ts)
//
// WHY INTEGRATION: the boundary is a SQL predicate — tenant, validated document scope, approval
// gate, and (document, file, printed page) tuple binding via unnest. A mock that returns whatever
// the test wants cannot show that a deleted `tenant_id = $1` or a dropped `doc_id` in the tuple
// leaks. Each case runs through withTenantContext (SET LOCAL ROLE factorylm_app with row-level
// security switched ON for the table inside this test) AND on the raw owner pool, where RLS does
// not mask a missing predicate. Synthetic text only.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));

import { withTenantContext } from "@/lib/tenant-context";
import { REFERENCE_ROWS_PER_PAGE, retrieveReferencedPageChunks } from "@/capabilities/referenced-pages";
import type { ManualChunk } from "@/lib/manual-rag";

const T = "a6000000-0000-4000-8000-000000000001";
const OTHER = "a6000000-0000-4000-8000-0000000000ff";
const DOC_A = "a6000000-2222-4000-8000-00000000000a"; // the referring manual
const DOC_B = "a6000000-2222-4000-8000-00000000000b"; // a second selected manual
const DOC_U = "a6000000-2222-4000-8000-0000000000e1"; // same URL as A, but unselected
const DOC_C = "a6000000-2222-4000-8000-00000000000c"; // ambiguous printed label
const URL_A = "node-doc/shared/panel.pdf";
const URL_B = "node-doc/b/other.pdf";
const URL_C = "node-doc/c/dup.pdf";

type Seed = { tenant?: string; doc: string; url: string; page: number; label: string | null; content: string; priv?: boolean; verified?: boolean; idx?: number; extra?: Record<string, unknown> };
const S = (x: Seed) => x;
const ROWS: Seed[] = [
  // A: printed 45 is physical 47 (front matter shifts it); printed 20/40 exist on A too.
  S({ doc: DOC_A, url: URL_A, page: 47, label: "45", content: "A-STEPS printed 45 chunk one", idx: 0 }),
  S({ doc: DOC_A, url: URL_A, page: 47, label: "45", content: "A-STEPS printed 45 chunk two", idx: 1 }),
  S({ doc: DOC_A, url: URL_A, page: 22, label: "20", content: "A-TWENTY content" }),
  S({ doc: DOC_A, url: URL_A, page: 42, label: "40", content: "A-FORTY content" }),
  S({ doc: DOC_A, url: URL_A, page: 60, label: null, content: "A-UNLABELLED physical sixty" }),
  S({ doc: DOC_A, url: URL_A, page: 48, label: "46", content: "A-SHARED unverified shared row", priv: false, verified: false }),
  S({ doc: DOC_A, url: URL_A, page: 49, label: "47", content: "A-UNQUALIFIED flat table line", extra: { table_unqualified: true } }),
  // same URL, DIFFERENT document, not selected, same printed label
  S({ doc: DOC_U, url: URL_A, page: 47, label: "45", content: "U-UNSELECTED same url same label" }),
  // other tenant, SAME doc id / url / label: only a missing tenant predicate on the raw pool leaks it
  S({ tenant: OTHER, doc: DOC_A, url: URL_A, page: 47, label: "45", content: "OTHER-TENANT same doc id" }),
  // B: its own p40/p20 labels, crossing A's must never happen
  S({ doc: DOC_B, url: URL_B, page: 41, label: "40", content: "B-FORTY content" }),
  S({ doc: DOC_B, url: URL_B, page: 21, label: "20", content: "B-TWENTY content" }),
  // C: two physical pages claim printed 9 -> ambiguous
  S({ doc: DOC_C, url: URL_C, page: 9, label: "9", content: "C-NINE first" }),
  S({ doc: DOC_C, url: URL_C, page: 10, label: "9", content: "C-NINE second" }),
  // a crowded page: more chunks than the per-page cap
  ...Array.from({ length: 12 }, (_, i) => S({ doc: DOC_A, url: URL_A, page: 70, label: "68", content: `A-CROWD chunk ${i}`, idx: i })),
];

const chunk = (docId: string, sourceUrl: string, content: string, page = 1): ManualChunk => ({
  content, docId, sourceUrl, sourcePage: page, pageLabel: String(page), title: "t", manufacturer: "M", modelNumber: "X",
  rank: 1, verified: false, chunkIndex: null,
});

let rlsWasOn = false;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required — see the header recipe.");
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw new Error("Refusing to run against a non-disposable database.");
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  const r = await testPool.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'knowledge_entries'");
  rlsWasOn = r.rows[0].relrowsecurity === true;
  await testPool.query("ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY");
  await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = ANY($1::uuid[])", [[T, OTHER]]);
  for (const r2 of ROWS) {
    await testPool.query(
      `INSERT INTO knowledge_entries (tenant_id, doc_id, content, source_type, source_url, source_page, page_start, ingest_route, metadata, is_private, verified)
       VALUES ($1::uuid, $2::uuid, $3, 'node_attachment', $4, $5, $5, 'v2',
               jsonb_build_object('chunk_index', $6::int, 'page_label', $7::text) || $8::jsonb, $9, $10)`,
      [r2.tenant ?? T, r2.doc, r2.content, r2.url, r2.page, r2.idx ?? 0, r2.label, JSON.stringify(r2.extra ?? {}), r2.priv ?? true, r2.verified ?? false],
    );
  }
  // a NULL page_label must be stored as absent, not the JSON string "null"
  await testPool.query("UPDATE knowledge_entries SET metadata = metadata - 'page_label' WHERE tenant_id = ANY($1::uuid[]) AND metadata->>'page_label' IS NULL", [[T, OTHER]]);
});

afterAll(async () => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  await testPool.query("DELETE FROM knowledge_entries WHERE tenant_id = ANY($1::uuid[])", [[T, OTHER]]);
  if (!rlsWasOn) await testPool.query("ALTER TABLE knowledge_entries DISABLE ROW LEVEL SECURITY");
  await testPool.end();
});

type Lane = "rls" | "raw";
async function run(lane: Lane, tenant: string, retrieved: ManualChunk[], docIds: string[]) {
  const opts = { docIds, approvedSourceDocIds: docIds };
  if (lane === "rls") return withTenantContext(tenant, (c) => retrieveReferencedPageChunks(c, tenant, retrieved, opts));
  const c = await testPool.connect();
  try {
    return await retrieveReferencedPageChunks(c, tenant, retrieved, opts);
  } finally {
    c.release();
  }
}

describe.each<Lane>(["rls", "raw"])("referenced-page read on the %s lane (gate ON)", (lane) => {
  it("printed 45 resolves to PHYSICAL page 47 of the originating document; every chunk of that page, nothing else", async () => {
    const out = await run(lane, T, [chunk(DOC_A, URL_A, "Configuration: see page 45.", 44)], [DOC_A, DOC_B]);
    expect(out.map((c) => c.content)).toEqual(["A-STEPS printed 45 chunk one", "A-STEPS printed 45 chunk two"]);
    expect(out.every((c) => c.docId === DOC_A && c.sourceUrl === URL_A && c.sourcePage === 47 && c.pageLabel === "45" && c.rank === 0)).toBe(true);
  });

  it("a same-URL different document is never returned, even when it is selected AND retrieved itself", async () => {
    // U shares A's file name and has printed label 45 on the same physical page. Only A's own
    // tuple may bind: a read keyed on (file, page) alone would hand U's passage back under U's identity.
    const retrieved = [chunk(DOC_A, URL_A, "see page 45.", 44), chunk(DOC_U, URL_A, "unrelated U passage", 3)];
    const out = await run(lane, T, retrieved, [DOC_A, DOC_U]);
    expect(out.map((c) => c.content).join("|")).not.toContain("U-UNSELECTED");
    expect(out.map((c) => c.content)).toEqual(["A-STEPS printed 45 chunk one", "A-STEPS printed 45 chunk two"]);
    expect(out.every((c) => c.docId === DOC_A)).toBe(true);
  });

  it("another tenant's rows with the same document id, file and label are never returned", async () => {
    const out = await run(lane, T, [chunk(DOC_A, URL_A, "see page 45.", 44)], [DOC_A]);
    expect(out.map((c) => c.content).join("|")).not.toContain("OTHER-TENANT");
    expect(await run(lane, OTHER, [chunk(DOC_A, URL_A, "see page 45.", 44)], [DOC_A]).then((r) => r.map((c) => c.content))).toEqual(["OTHER-TENANT same doc id"]);
  });

  it("manual A -> p20 and manual B -> p40 never cross: no A p40 and no B p20", async () => {
    const out = await run(lane, T, [chunk(DOC_A, URL_A, "see page 20.", 1), chunk(DOC_B, URL_B, "see page 40.", 1)], [DOC_A, DOC_B]);
    expect(out.map((c) => c.content).sort()).toEqual(["A-TWENTY content", "B-FORTY content"]);
  });

  it("a document outside the validated scope is not read at all", async () => {
    expect(await run(lane, T, [chunk(DOC_B, URL_B, "see page 40.", 1)], [DOC_A])).toEqual([]);
  });

  it("ambiguous printed labels (two physical pages) and unlabelled pages fail closed", async () => {
    expect(await run(lane, T, [chunk(DOC_C, URL_C, "see page 9.", 1)], [DOC_C])).toEqual([]);
    expect(await run(lane, T, [chunk(DOC_A, URL_A, "see page 60.", 1)], [DOC_A])).toEqual([]); // physical 60 exists but no label says 60
  });

  it("approval gate: an unverified SHARED row of a selected document is not admitted; unqualified table lines are dropped", async () => {
    expect(await run(lane, T, [chunk(DOC_A, URL_A, "see page 46.", 1)], [DOC_A])).toEqual([]);
    expect(await run(lane, T, [chunk(DOC_A, URL_A, "see page 47.", 1)], [DOC_A])).toEqual([]);
  });

  it("a crowded page is capped per page", async () => {
    const out = await run(lane, T, [chunk(DOC_A, URL_A, "see page 68.", 1)], [DOC_A]);
    expect(out).toHaveLength(REFERENCE_ROWS_PER_PAGE);
    expect(out.map((c) => c.content)[0]).toBe("A-CROWD chunk 0");
  });
});
