/**
 * #5955 — citation page integrity over ACTUAL SQL (disposable loopback PostgreSQL).
 *
 * Fixture boundaries (read before trusting a green):
 *  - `knowledge_entries` / `namespace_direct_uploads` are hand-written TEMP tables carrying only the
 *    columns retrieval and the page-fact read touch. No RLS, no grants, no indexes, no triggers, no
 *    other migrations: tenant/visibility/approval are exercised through the queries' own predicates,
 *    not through RLS. The tables are session-local and ON COMMIT DROP inside one rolled-back tx.
 *  - Fixture documents are small (tens of rows), not the 989-row staging copy; the corruption SHAPES
 *    (all-page-1, page == chunk ordinal, real pages) are the real ones.
 *  - Nothing here proves the real PDF page of any legacy row; the contract is "unknown, not guessed".
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/citation-integrity.integration.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { annotatePageTrust, type PassageChunk } from "@/capabilities/citation-passages";
import { lockoutPageOf } from "@/capabilities/energized-work-stop";
import { pageFromRetrievedChunks } from "@/lib/citation-page";
import { buildGroundedContext, chunksToSources, retrieveManualChunks, retrieveNodeChunks } from "@/lib/manual-rag";

const CALLER = "59550000-0000-4000-8000-000000000001";
const OTHER = "59550000-0000-4000-8000-000000000002";
const SYSTEM = "59550000-0000-4000-8000-0000000000aa";
const NODE_DOC = "59550000-0000-4000-8000-000000000011";
const NODE_DOC_MULTI = "59550000-0000-4000-8000-000000000012";
const FOREIGN_DOC = "59550000-0000-4000-8000-000000000013";
const LEGACY = "gdrive://520-um001_-en-e (1).pdf";
const ORDINAL = "gdrive://520-um001_-en-e.pdf";
const REAL = "https://crawler.invalid/520-um001_-en-e.pdf";
const ONE_ROW = "gdrive://pf525-addendum.pdf";
const SAMPLE_ONLY = "gdrive://pf525-quick-start.pdf";
const F004 = "Fault F004 UnderVoltage: the DC bus voltage fell below the minimum value. Check the incoming line voltage.";
const QUESTION = "What does fault F004 mean";
// A bare fault code makes the notebook search ask which model is meant (named-model scope); the
// node tests are about pages, so they ask in words.
const NODE_QUESTION = "What does the UnderVoltage fault mean, DC bus voltage";
let client: Client;

async function seed(o: {
  url: string; page: number | null; chunk: number | null; content?: string; tenant?: string; priv?: boolean;
  verified?: boolean; doc?: string | null; pageStart?: number | null; model?: string; title?: string; pageNum?: string;
}) {
  await client.query(
    `INSERT INTO knowledge_entries
       (tenant_id, doc_id, content, manufacturer, model_number, source_url, source_page, page_start, metadata, verified, is_private, ingest_route)
     VALUES ($1,$2,$3,'Allen-Bradley',$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [
      o.tenant ?? SYSTEM, o.doc ?? null, o.content ?? "Generic drive installation fault text.",
      o.model ?? "PowerFlex 525", o.url, o.page, o.pageStart ?? null,
      JSON.stringify({
        title: o.title ?? "PowerFlex 525 manual",
        ...(o.doc ? { node_id: "n-5955", filename: o.title } : {}),
        ...(o.chunk == null ? {} : { chunk_index: o.chunk }),
        ...(o.pageNum ? { page_num: o.pageNum } : {}),
      }),
      o.verified ?? true, o.priv ?? false, o.doc ? "v2" : null,
    ],
  );
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw Error("Disposable local database required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw Error("Only loopback Postgres permitted");
  client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, doc_id uuid,
    content text NOT NULL, content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text DEFAULT '', model_number text DEFAULT '', source_url text NOT NULL,
    source_page integer, page_start integer, section_path text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    verified boolean NOT NULL DEFAULT false, is_private boolean NOT NULL DEFAULT false, ingest_route text
  ) ON COMMIT DROP`);
  await client.query(`CREATE TEMP TABLE namespace_direct_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, upload_id uuid, source text NOT NULL DEFAULT 'user_upload'
  ) ON COMMIT DROP`);

  // 1. Legacy copy: EVERY row source_page = 1 (the staging 989-row PowerFlex 525 shape).
  for (let i = 0; i < 30; i++) await seed({ url: LEGACY, page: 1, chunk: i, pageNum: "1", content: i === 7 ? F004 : `Legacy copy filler ${i} fault.` });
  // 2. Ordinal copy: source_page == chunk_index (p.715 on a 274-page manual).
  for (let i = 700; i < 730; i++) await seed({ url: ORDINAL, page: i, chunk: i, pageNum: "1", content: i === 715 ? F004 : `Ordinal copy filler ${i} fault.` });
  // 3. Page-aware crawler copy: real pages (161 holds F004); chunk ordinal differs from the page.
  for (let i = 0; i < 26; i++) await seed({ url: REAL, page: 150 + i, chunk: i * 3, pageNum: String(150 + i), content: 150 + i === 161 ? F004 : `Crawler copy filler ${i} fault.` });
  // 4. One-row legacy document: a count cannot tell it from a real one-page document.
  await seed({ url: ONE_ROW, page: 3, chunk: 0, content: F004 });
  // 5. Sample-only single page: the retrieved sample shows ONE page but the document has two.
  for (let i = 0; i < 5; i++) await seed({ url: SAMPLE_ONLY, page: 5, chunk: 100 + i, content: `${F004} Variant ${i}.` });
  await seed({ url: SAMPLE_ONLY, page: 90, chunk: 200, content: "Appendix without the keywords." });
  // 6. Scope decoys on the LEGACY address — each would flip its verdict to trusted if counted:
  //    another tenant's private rows, an unapproved shared row set, and private rows with no doc id.
  for (let p = 2; p < 30; p++) await seed({ url: LEGACY, page: p, chunk: 500 + p, tenant: OTHER, priv: true, content: `Foreign private ${p}.` });
  for (let p = 2; p < 30; p++) await seed({ url: LEGACY, page: p, chunk: 600 + p, verified: false, content: `Unapproved shared ${p}.` });
  // 7. Node (v2) documents: explicit page_start provenance.
  for (let i = 0; i < 4; i++)
    await seed({ url: `hub://${NODE_DOC}/one.pdf`, page: 1, pageStart: 1, chunk: i, doc: NODE_DOC, tenant: CALLER, priv: true, verified: false, model: "", title: "one.pdf", content: i === 0 ? F004 : `One-page doc text ${i}.` });
  for (let i = 0; i < 4; i++)
    await seed({ url: `hub://${NODE_DOC_MULTI}/multi.pdf`, page: 10 + i, pageStart: 10 + i, chunk: i, doc: NODE_DOC_MULTI, tenant: CALLER, priv: true, verified: false, model: "", title: "multi.pdf", content: i === 0 ? F004 : `Multi doc text ${i}.` });
  await seed({ url: `hub://${FOREIGN_DOC}/x.pdf`, page: 4, pageStart: 4, chunk: 0, doc: FOREIGN_DOC, tenant: OTHER, priv: true, verified: false, model: "", title: "x.pdf", content: F004 });
});

afterAll(async () => {
  await client?.query("ROLLBACK");
  await client?.end();
});

// Production runs with the approval gate on; the decoy rows below are unapproved, so the gate is
// what makes them invisible to retrieval AND to the page-fact read.
beforeEach(() => {
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
});
afterEach(() => {
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
});

const oem = (extra: Record<string, unknown> = {}) =>
  retrieveManualChunks(client as unknown as PoolClient, CALLER, QUESTION, {
    manufacturer: "Allen-Bradley", model: "PowerFlex 525", topK: 40, allowTenantFallback: false, ...extra,
  });
const f004 = (chunks: Awaited<ReturnType<typeof oem>>, url: string) => chunks.filter((c) => c.sourceUrl === url && c.content === F004);

describe("#5955 the original defect, through the real retrieval query and the public builders", () => {
  it("precondition: the real SQL returns the F004 row of every fixture copy, with its RAW stamped page", async () => {
    const chunks = await oem();
    expect(f004(chunks, LEGACY).map((c) => c.sourcePage)).toEqual([1]);
    expect(f004(chunks, ORDINAL).map((c) => c.sourcePage)).toEqual([715]);
    expect(f004(chunks, REAL).map((c) => c.sourcePage)).toEqual([161]);
  });

  it("legacy all-page-1 copy: no p.1 chip, no p.1 in the model's block, no page to deep-link", async () => {
    const chunks = await oem();
    const legacy = f004(chunks, LEGACY);
    expect(legacy).toHaveLength(1);
    expect(chunksToSources(legacy)[0].page).toBeNull();
    expect(buildGroundedContext(legacy)).not.toMatch(/p\.\d/);
  });

  it("ordinal-stamped copy (p.715): the page is withheld", async () => {
    const ordinal = f004(await oem(), ORDINAL);
    expect(chunksToSources(ordinal)[0].page).toBeNull();
    expect(buildGroundedContext(ordinal)).not.toContain("p.715");
  });

  it("control: the page-aware crawler copy keeps its real page 161", async () => {
    const real = f004(await oem(), REAL);
    expect(chunksToSources(real)[0].page).toBe(161);
    expect(buildGroundedContext(real)).toContain("p.161");
  });

  it("control: a one-row legacy document with no anchor is unknown (a count cannot prove a page)", async () => {
    const one = f004(await oem(), ONE_ROW);
    expect(one).toHaveLength(1);
    expect(chunksToSources(one)[0].page).toBeNull();
  });
});

describe("#5955 C1 — the real compound corruption: metadata.page_num = \"1\" on every row of the ordinal copies", () => {
  it("precondition: the real PAGE_LABEL_SQL hands the stop/banner a bare \"1\" label beside the p.715 stamp", async () => {
    const ordinal = f004(await oem(), ORDINAL)[0];
    expect(ordinal).toMatchObject({ sourcePage: 715, chunkIndex: 715, pageLabel: "1" });
  });
  it.each([["ordinal copy", ORDINAL], ["all-page-1 copy", LEGACY]])("%s: the safety-stop page and the hazard-banner page are withheld, not the cover \"1\"", async (_n, url) => {
    const c = f004(await oem(), url)[0];
    expect(c.pageLabel).toBe("1");
    expect(lockoutPageOf(c)).toBeNull();
    expect(pageFromRetrievedChunks([c])).toBeNull();
  });
  it("control: the page-aware copy keeps its printed page 161 on both", async () => {
    const c = f004(await oem(), REAL)[0];
    expect(c.pageLabel).toBe("161");
    expect(lockoutPageOf(c)).toBe("161");
    expect(pageFromRetrievedChunks([c])).toBe("161");
  });
});

describe("#5955 the verdict reads EVERY authorized approved row of the document, not the retrieved sample", () => {
  it("control: a sample that is all one page is trusted when the document as a whole shows two pages", async () => {
    const chunks = await oem();
    const sample = chunks.filter((c) => c.sourceUrl === SAMPLE_ONLY && c.sourcePage === 5);
    expect(sample.length).toBeGreaterThan(1);
    expect(new Set(chunks.filter((c) => c.sourceUrl === SAMPLE_ONLY).map((c) => c.sourcePage)).size).toBe(1);
    expect(chunksToSources(sample)[0].page).toBe(5);
  });

  it("another tenant's private rows and unapproved rows at the legacy address do NOT make it look page-diverse", async () => {
    const legacy = f004(await oem(), LEGACY);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].pageTrust).toBe("unknown");
    expect(chunksToSources(legacy)[0].page).toBeNull();
  });

  it("the diversity count is live: approved SHARED rows of the same address with other pages DO change the verdict", async () => {
    // Control for the decoys above: same address, but visible and approved to this caller.
    for (let p = 2; p < 6; p++) await seed({ url: LEGACY, page: p, chunk: 700 + p, content: `Approved shared extra ${p}.` });
    try {
      const legacy = f004(await oem(), LEGACY);
      expect(legacy[0].pageTrust).toBe("trusted");
    } finally {
      // The rows seeded above are shared (public) rows of the system tenant; delete exactly that scope.
      await client.query(
        "DELETE FROM knowledge_entries WHERE tenant_id = $2 AND is_private = false AND source_url = $1 AND content LIKE 'Approved shared extra%'",
        [LEGACY, SYSTEM],
      );
    }
  });

  it("verdicts are read in at most one grouped query for a many-document result (never one per chunk)", async () => {
    const seen: string[] = [];
    const wrapped = { query: (sql: string, p?: unknown[]) => { if (sql.includes("AS anchored")) seen.push(sql); return client.query(sql, p); } };
    const chunks = await retrieveManualChunks(wrapped as unknown as PoolClient, CALLER, QUESTION, {
      manufacturer: "Allen-Bradley", model: "PowerFlex 525", topK: 40, allowTenantFallback: false,
    });
    expect(new Set(chunks.map((c) => c.sourceUrl)).size).toBeGreaterThanOrEqual(5);
    expect(chunks.length).toBeGreaterThan(10);
    expect(seen).toHaveLength(1);
  });
});

describe("#5955 node (v2) documents: explicit page_start provenance, tenant + approval scope", () => {
  const node = (docIds: string[], approved: string[], tenant = CALLER) =>
    retrieveNodeChunks(client as unknown as PoolClient, tenant, NODE_QUESTION, {
      nodeId: "n-5955", unsPath: null, docIds, approvedSourceDocIds: approved, validatedDocScope: true, rawQuery: NODE_QUESTION, topK: 6,
    });

  it("a TRUE one-page document with page_start keeps its page (counting pages alone would have hidden it)", async () => {
    const hits = await node([NODE_DOC], [NODE_DOC]);
    const hit = hits.find((h) => h.docId === NODE_DOC && h.content === F004);
    expect(hit).toMatchObject({ sourcePage: 1, pageAnchored: true, pageTrust: "trusted" });
    expect(chunksToSources([hit!])[0].page).toBe(1);
  });

  it("a multi-page v2 document keeps each real page", async () => {
    const hit = (await node([NODE_DOC_MULTI], [NODE_DOC_MULTI])).find((h) => h.content === F004);
    expect(chunksToSources([hit!])[0].page).toBe(10);
  });

  it("another tenant's document is never returned, so it can never lend a page", async () => {
    const hits = await node([FOREIGN_DOC], [FOREIGN_DOC]);
    expect(hits).toEqual([]);
  });

  it("another tenant's rows that share a document id never lend page diversity to the caller's document", async () => {
    const DOC = "59550000-0000-4000-8000-000000000015";
    for (let i = 0; i < 4; i++)
      await seed({ url: `hub://${DOC}/mine.pdf`, page: 1, pageStart: null, chunk: i, doc: DOC, tenant: CALLER, priv: true, verified: false, model: "", title: "mine.pdf", content: i === 0 ? F004 : `Mine text ${i}.` });
    // Same document id, different tenant, many pages: under the caller's scope these must not exist.
    for (let p = 2; p < 12; p++)
      await seed({ url: `hub://${DOC}/theirs.pdf`, page: p, pageStart: null, chunk: 40 + p, doc: DOC, tenant: OTHER, priv: true, verified: false, model: "", title: "theirs.pdf", content: `Theirs text ${p}.` });
    const hit = (await node([DOC], [DOC])).find((h) => h.content === F004);
    expect(hit).toMatchObject({ sourcePage: 1, pageTrust: "unknown" });
  });

  it("an unanchored node row (page_start null) falls to the document verdict: all one page → unknown", async () => {
    const DOC = "59550000-0000-4000-8000-000000000014";
    for (let i = 0; i < 4; i++)
      await seed({ url: `hub://${DOC}/stamped.pdf`, page: 1, pageStart: null, chunk: i, doc: DOC, tenant: CALLER, priv: true, verified: false, model: "", title: "stamped.pdf", content: i === 0 ? F004 : `Stamped doc text ${i}.` });
    const hit = (await node([DOC], [DOC])).find((h) => h.content === F004);
    expect(hit).toMatchObject({ sourcePage: 1, pageAnchored: false, pageTrust: "unknown" });
    expect(chunksToSources([hit!])[0].page).toBeNull();
  });
});

describe("#5955 OEM search also returns the caller's own private rows: their pages are withheld, not guessed", () => {
  it("a private row has no document id on the OEM mapper and no anchor, and address facts are shared-only ⇒ unknown", async () => {
    const PRIV_DOC = "59550000-0000-4000-8000-000000000016";
    await seed({ url: `hub://${PRIV_DOC}/mine.pdf`, page: 7, pageStart: 7, chunk: 0, doc: PRIV_DOC, tenant: CALLER, priv: true, verified: true, content: `${F004} Private upload.` });
    const hit = (await oem()).find((c) => c.content.includes("Private upload."));
    expect(hit).toMatchObject({ sourcePage: 7, pageTrust: "unknown" });
    expect(chunksToSources([hit!])[0].page).toBeNull();
  });
});

// LAST in the file on purpose: the mutation that removes the savepoint aborts this transaction.
describe("#5955 a failed page-fact read inside a transaction does not poison the caller's transaction", () => {
  const broken = { forDocs: () => "AND no_such_column = 1", docParams: [], forUrls: "" };
  const legacyRow: PassageChunk[] = [{ content: "x", sourceUrl: LEGACY, sourcePage: 1, docId: NODE_DOC_MULTI, chunkIndex: 1 }];
  it("with a savepoint: pages are withheld and the next statement on the same client still works", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await annotatePageTrust(client, CALLER, legacyRow, broken, { savepoint: true });
    expect(out[0].pageTrust).toBe("unknown");
    const next = await client.query("SELECT 1 AS ok");
    expect(next.rows[0].ok).toBe(1);
    warn.mockRestore();
  });
});
