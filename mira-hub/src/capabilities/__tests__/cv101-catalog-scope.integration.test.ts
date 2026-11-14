import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { approvalGateEnabled, retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = "52850000-0000-4000-8000-000000000011";
const OTHER_TENANT = "52850000-0000-4000-8000-000000000012";
const CURRENT = "52850000-0000-4000-8000-000000000021";
const OLD_REVISION = "52850000-0000-4000-8000-000000000022";
const OTHER_ASSET = "52850000-0000-4000-8000-000000000023";
const SIBLING = "52850000-0000-4000-8000-000000000024";
const EXACT_CATALOG = "53300000-0000-4000-8000-000000000001";
const QUESTION = "For the GS11N-20P2 drive in this project, which parameter controls acceleration time? Explain what it controls and cite the exact manual page. Do not recommend a new setting or assume the present drive settings.";
let client: Client;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Explicit disposable TEST_DATABASE_URL and MIRA_TEST_DB_CONFIRM required");
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Only isolated local Postgres is permitted");
  client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
    content text NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text NOT NULL DEFAULT '', model_number text NOT NULL DEFAULT '',
    source_url text NOT NULL, source_page integer, page_start integer,
    section_path text, metadata jsonb NOT NULL, verified boolean NOT NULL,
    is_private boolean NOT NULL, doc_id uuid NOT NULL, ingest_route text NOT NULL
  ) ON COMMIT DROP`);
  for (const [tenant, doc, heading, marker] of [
    [TENANT, CURRENT, "DURApulse GS10 AC Drive User Manual", "selected revision C"],
    [TENANT, OLD_REVISION, "DURApulse GS10 AC Drive User Manual", "obsolete revision B"],
    [TENANT, OTHER_ASSET, "DURApulse GS10 AC Drive User Manual", "other asset"],
    [TENANT, SIBLING, "GS10 GS13N AC Drive User Manual", "sibling only"],
    [TENANT, EXACT_CATALOG, "GS11N-20P2 AC Drive User Manual", "exact catalog"],
    [OTHER_TENANT, CURRENT, "DURApulse GS10 AC Drive User Manual", "foreign tenant"],
  ]) {
    for (const [page, text] of [
      [1, heading],
      [139, `P01.12 Acceleration Time 1. Acceleration time controls the ramp from zero to maximum operation frequency. ${marker}`],
    ] as const) {
      await client.query(`INSERT INTO knowledge_entries
        (tenant_id, content, source_url, source_page, page_start, metadata,
         verified, is_private, doc_id, ingest_route)
        VALUES ($1,$2,'https://test.invalid/manual.pdf',$3,$3,$4::jsonb,false,true,$5,'v2')`,
      [tenant, text, page, JSON.stringify({ node_id: "cv101-fixture", filename: "gs10usermanual.pdf", page_label: page === 139 ? "4-69" : "cover", chunk_index: 0 }), doc]);
    }
  }
  // Catalog-heavy specification pages can win rarity scoring even though
  // none answers the question's topic. The parameter page must survive topK.
  for (let page = 400; page < 407; page++) {
    await client.query(`INSERT INTO knowledge_entries
      (tenant_id, content, source_url, source_page, page_start, metadata,
       verified, is_private, doc_id, ingest_route)
      VALUES ($1,$2,'https://test.invalid/manual.pdf',$3,$3,$4::jsonb,false,true,$5,'v2')`,
    [TENANT, "GS11N-20P2 drive parameter controls and present drive settings. GS11N-20P2 catalog technical specification.", page,
      JSON.stringify({ node_id: "cv101-fixture", filename: "gs10usermanual.pdf", chunk_index: 0 }), CURRENT]);
  }
  // Long-manual frequency context: boilerplate is common, catalog suffixes
  // are rare. Without these rows a tiny fixture inverts the real IDF signal.
  for (let page = 700; page < 740; page++) {
    await client.query(`INSERT INTO knowledge_entries
      (tenant_id, content, source_url, source_page, page_start, metadata,
       verified, is_private, doc_id, ingest_route)
      VALUES ($1,$2,'https://test.invalid/manual.pdf',$3,$3,$4::jsonb,false,true,$5,'v2')`,
    [TENANT, "Drive parameter controls, acceleration time and present drive settings.", page,
      JSON.stringify({ node_id: "cv101-fixture", filename: "gs10usermanual.pdf", chunk_index: 0 }), CURRENT]);
  }
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    await client.end();
  }
});

beforeEach(() => {
  vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
  expect(approvalGateEnabled()).toBe(true);
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("NOTEBOOK_RERANK", "0");
  vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider/network in the SQL fixture"); }));
});

afterEach(() => {
  if (process.env.NOTEBOOK_RERANK !== "1") expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function retrieve(question = QUESTION, docIds = [CURRENT], approved = docIds, tenant = TENANT) {
  return retrieveNodeChunks(client as unknown as PoolClient, tenant, question, {
    nodeId: "cv101-fixture", unsPath: null, docIds, approvedSourceDocIds: approved,
    validatedDocScope: true, rawQuery: question, topK: 6,
  });
}

describe("CV101 catalog applicability over actual SQL", () => {
  it("#5330: dash prose admits the approved exact-catalog manual through real SQL", async () => {
    const hits = await retrieve("GS11N - which parameter controls acceleration time?", [EXACT_CATALOG]);
    expect(hits.some((hit) => hit.docId === EXACT_CATALOG && hit.sourcePage === 139 && hit.content.includes("P01.12"))).toBe(true);
  });

  it("#5330: dash prose never bypasses document approval", async () => {
    expect(await retrieve("GS11N - which parameter controls acceleration time?", [EXACT_CATALOG], [CURRENT])).toEqual([]);
  });

  it("#5330: an explicit different catalog still refuses the selected manual", async () => {
    expect(await retrieve("GS11N-21P0 - which parameter controls acceleration time?", [EXACT_CATALOG])).toEqual([]);
  });

  it("the unhinted question retrieves the selected family's parameter with both locators", async () => {
    const hits = await retrieve();
    expect(hits.some((hit) => hit.docId === CURRENT && hit.sourcePage === 139
      && hit.pageLabel === "4-69" && hit.content.includes("P01.12"))).toBe(true);
    expect(hits.every((hit) => hit.docId === CURRENT && !hit.content.includes("foreign tenant"))).toBe(true);
  });

  it("rejects a different model even when SQL offers acceleration matches", async () => {
    expect(await retrieve(QUESTION.replace("GS11N-20P2", "GS20"))).toEqual([]);
  });

  it("rejects a specifically sibling-only manual within selected documents", async () => {
    expect(await retrieve(QUESTION, [SIBLING])).toEqual([]);
  });

  it("an unrelated query does not acquire an acceleration passage", async () => {
    expect(await retrieve("hydraulic accumulator nitrogen precharge")).toEqual([]);
  });

  it.each(["false", "true"])("validated revision/asset scope cannot be broadened by stale approval ids (gate=%s)", async (gate) => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", gate);
    expect(approvalGateEnabled()).toBe(gate === "true");
    const hits = await retrieve(QUESTION, [CURRENT], [CURRENT, OLD_REVISION, OTHER_ASSET]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.docId === CURRENT
      && !/obsolete revision|other asset|foreign tenant/.test(hit.content))).toBe(true);
  });

  it("a selected but unapproved private revision remains ineligible", async () => {
    expect(await retrieve(QUESTION, [OLD_REVISION], [CURRENT])).toEqual([]);
  });

  it("a different tenant cannot retrieve this notebook's private document", async () => {
    expect(await retrieve(QUESTION, [CURRENT], [CURRENT], "52850000-0000-4000-8000-000000000099")).toEqual([]);
  });

  it("reranking sees only admitted current-revision passages, never a selected sibling or unapproved revision", async () => {
    vi.stubEnv("NOTEBOOK_RERANK", "1");
    vi.stubEnv("RERANKER_URL", "http://rerank.test.invalid");
    const scorer = vi.fn(async (_url: string, init: RequestInit) => {
      const { query, passages } = JSON.parse(String(init.body)) as { query: string; passages: string[] };
      expect(query).toBe(QUESTION);
      expect(passages.length).toBeGreaterThan(2);
      expect(passages.every((p) => !/sibling only|obsolete revision|other asset|foreign tenant/.test(p))).toBe(true);
      return new Response(JSON.stringify({ scores: passages.map((p) => /sibling only|obsolete revision/.test(p) ? 100 : p.includes("P01.12") ? 10 : 0) }));
    });
    vi.stubGlobal("fetch", scorer);
    const hits = await retrieve(QUESTION, [CURRENT, SIBLING, OLD_REVISION], [CURRENT, SIBLING]);
    expect(scorer).toHaveBeenCalledTimes(1);
    expect(hits.every((hit) => hit.docId === CURRENT)).toBe(true);
    expect(hits.some((hit) => hit.sourcePage === 139 && hit.content.includes("P01.12"))).toBe(true);
  });
});
