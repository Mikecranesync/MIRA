/** Public fictional passage bodies, real retrieval SQL/admission, disposable
 * TEMP table only. No provider, model, embedding or reranking request is allowed. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = "84000000-0000-4000-8000-000000000001", FOREIGN = "84000000-0000-4000-8000-000000000002";
const doc = (n: number) => `84000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
const OWN_DOC = doc(1), KNOWN_DOC = doc(2), SIBLING_DOC = doc(3), OTHER_NODE_DOC = doc(4), OLD_DOC = doc(5);
const TABLE_OWN = doc(6), TABLE_SIBLING = doc(7), TABLE_UNQUALIFIED = doc(8);
const OWN = "ZX731-04A", SIBLING = "ZX731-09C", KNOWN = "GS11N-20P2", KNOWN_SIBLING = "GS11N-20P5";
const NODE = "catalog-fold-current", BODY = "UNIT_FICTIONAL_LEGEND: indicator legend and reference marker description. No physical setting is asserted.";
const variants = ["-", "\u2011", "\u2013", " - ", " \u2011 ", " \u2013 "];
const spell = (identifier: string, separator: string) => identifier.replaceAll("-", separator);
let client: Client;

type Options = Parameters<typeof retrieveNodeChunks>[3];
async function insert(tenant: string, document: string, heading: string, filename: string, metadata: Record<string, unknown> = {}, node = NODE) {
  for (const [page, content] of [[1, heading], [7, BODY]] as const) {
    await client.query(`INSERT INTO knowledge_entries
      (tenant_id, content, source_url, source_page, page_start, metadata, doc_id, ingest_route, verified, is_private)
      VALUES ($1,$2,$3,$4,$4,$5::jsonb,$6,'v2',false,true)`,
    [tenant, content, `https://manual.unit.invalid/${document}`, page,
      JSON.stringify({ node_id: node, filename, chunk_index: page + 10, ...metadata }), document]);
  }
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw Error("Explicit disposable database confirmation required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  const disposableName = /(?:test|disposable)/i.test(database);
  const sharedName = /(?:prod(?:uction)?|prd|stag(?:e|ing))/i.test(database);
  if (!local || !disposableName || sharedName) {
    throw Error("Only explicitly confirmed local test/disposable Postgres is permitted");
  }
  client = new Client({ connectionString: url.href }); await client.connect(); await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '5000ms'");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, content text NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED,
    manufacturer text NOT NULL DEFAULT '', model_number text NOT NULL DEFAULT '', source_url text NOT NULL,
    source_page integer, page_start integer, section_path text, metadata jsonb NOT NULL,
    verified boolean NOT NULL, is_private boolean NOT NULL, doc_id uuid NOT NULL, ingest_route text NOT NULL
  ) ON COMMIT DROP`);
  await insert(TENANT, OWN_DOC, `${OWN} Logic Controller\nUser Manual`, `${OWN}.pdf`);
  await insert(TENANT, KNOWN_DOC, `${KNOWN} AC Drive\nUser Manual`, `${KNOWN}.pdf`);
  await insert(TENANT, SIBLING_DOC, `${SIBLING} Logic Controller\nUser Manual`, `${SIBLING}.pdf`);
  await insert(TENANT, OTHER_NODE_DOC, `${OWN} Logic Controller\nUser Manual`, `${OWN}.pdf`, {}, "catalog-fold-other-node");
  await insert(TENANT, OLD_DOC, `${OWN} Logic Controller\nUser Manual`, `${OWN}.pdf`);
  await insert(FOREIGN, OWN_DOC, `${OWN} Logic Controller\nUser Manual`, `${OWN}.pdf`);
  await insert(TENANT, TABLE_OWN, "DURApulse GS10 AC Drive User Manual", "gs10-guide.pdf", { table_models: ["GS11N20P2"] });
  await insert(TENANT, TABLE_SIBLING, "DURApulse GS10 AC Drive User Manual", "gs10-guide.pdf", { table_models: ["GS11N20P5"] });
  await insert(TENANT, TABLE_UNQUALIFIED, "DURApulse GS10 AC Drive User Manual", "gs10-guide.pdf", { table_models: ["GS11N20P2", "GS11N20P5"], table_unqualified: true });
  for (const [index, separator] of variants.entries()) {
    await insert(TENANT, doc(20 + index), `${spell(OWN, separator)} Logic Controller\nUser Manual`, `${OWN}.pdf`);
    await insert(TENANT, doc(30 + index), `${OWN} Logic Controller\nUser Manual`, `${spell(OWN, separator)}.pdf`);
    await insert(TENANT, doc(40 + index), `${OWN} Logic Controller\nUser Manual`, `${spell(SIBLING, separator)}.pdf`);
  }
});
afterAll(async () => { if (client) { await client.query("ROLLBACK"); await client.end(); } });
beforeEach(() => {
  for (const [key, value] of Object.entries({ MIRA_ENFORCE_APPROVED_RETRIEVAL: "true", NOTEBOOK_HYBRID_RETRIEVAL: "0",
    NOTEBOOK_RERANK: "0", NOTEBOOK_LEXICAL_V2: "0", NOTEBOOK_QUERY_REWRITE: "0", MIRA_JEV_SHADOW: "0", NOTEBOOK_SEMANTIC_CHECK: "0" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Unexpected inference/network request in disposable catalog SQL test"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function retrieve(question: string, ids = [OWN_DOC], extra: Partial<Options> = {}, tenant = TENANT) {
  return retrieveNodeChunks(client as unknown as PoolClient, tenant, question, {
    nodeId: NODE, unsPath: null, topK: 6, docIds: ids, approvedSourceDocIds: ids,
    validatedDocScope: true, rawQuery: question, ...extra,
  });
}
const question = (identifier: string) => `For ${identifier}, which fictional indicator legend applies?`;
const record = (identifier: string): Partial<Options> => ({
  identity: { manufacturer: "Unit fixture", model: identifier }, catalogNumber: identifier, identityStatus: "user_confirmed",
});
const knownRecord = (identifier: string): Partial<Options> => ({
  identity: { manufacturer: "AutomationDirect", model: "GS10" }, catalogNumber: identifier, identityStatus: "user_confirmed",
});
function hasLegend(hits: Awaited<ReturnType<typeof retrieve>>, expected: string) {
  expect(hits.some((hit) => hit.docId === expected && hit.sourcePage === 7 && hit.content === BODY)).toBe(true);
  expect(hits.every((hit) => hit.docId === expected)).toBe(true);
}

describe.each(variants)("identifier folding over actual SQL: separator %j", (separator) => {
  it("retains own fictional catalog question without a confirmed record", async () => {
    hasLegend(await retrieve(question(spell(OWN, separator))), OWN_DOC);
  });
  it("refuses the fictional sibling exactly as ASCII without a confirmed record", async () => {
    expect(await retrieve(question(SIBLING))).toEqual([]);
    expect(await retrieve(question(spell(SIBLING, separator)))).toEqual([]);
  });
  it("compares own question to the Unicode/spaced cover and filename", async () => {
    const index = variants.indexOf(separator);
    hasLegend(await retrieve(question(OWN), [doc(20 + index)]), doc(20 + index));
    hasLegend(await retrieve(question(OWN), [doc(30 + index)]), doc(30 + index));
  });
  it("does not let a sibling filename silently agree with the own cover", async () => {
    expect(await retrieve(question(OWN), [doc(40 + variants.indexOf(separator))])).toEqual([]);
  });
  it("retains a Unicode/spaced owner-confirmed fictional record without a model in the question", async () => {
    hasLegend(await retrieve("Which fictional indicator legend applies?", [OWN_DOC], record(spell(OWN, separator))), OWN_DOC);
  });
  it("refuses a sibling of the owner-confirmed fictional record", async () => {
    const confirmed = record(OWN);
    expect(await retrieve(question(SIBLING), [OWN_DOC], confirmed)).toEqual([]);
    expect(await retrieve(question(spell(SIBLING, separator)), [OWN_DOC], confirmed)).toEqual([]);
  });
  it("keeps the known own catalog and same-prefix sibling distinct in a confirmed record", async () => {
    const confirmed = knownRecord(KNOWN);
    hasLegend(await retrieve(question(spell(KNOWN, separator)), [KNOWN_DOC], confirmed), KNOWN_DOC);
    expect(await retrieve(question(KNOWN_SIBLING), [KNOWN_DOC], confirmed)).toEqual([]);
    expect(await retrieve(question(spell(KNOWN_SIBLING, separator)), [KNOWN_DOC], confirmed)).toEqual([]);
  });
  it("compares a Unicode/spaced known confirmed record to ASCII current table keys", async () => {
    const confirmed = knownRecord(spell(KNOWN, separator));
    hasLegend(await retrieve("Which fictional indicator legend applies?", [TABLE_OWN], confirmed), TABLE_OWN);
    expect(await retrieve("Which fictional indicator legend applies?", [TABLE_SIBLING], confirmed)).toEqual([]);
    expect(await retrieve("Which fictional indicator legend applies?", [TABLE_UNQUALIFIED], confirmed)).toEqual([]);
  });
});

describe("existing source and identity boundaries remain authoritative", () => {
  it("uses real tenant predicates even with an approved-looking foreign source ID", async () => {
    expect(await retrieve(question(OWN), [OWN_DOC], {}, doc(999))).toEqual([]);
  });
  it("cannot broaden current validated docs with stale approval IDs", async () => {
    const hits = await retrieve(question(OWN), [OWN_DOC], { approvedSourceDocIds: [OWN_DOC, OLD_DOC, SIBLING_DOC] });
    hasLegend(hits, OWN_DOC);
  });
  it("refuses selected private rows absent from the current approval intersection", async () => {
    expect(await retrieve(question(OWN), [OLD_DOC], { approvedSourceDocIds: [OWN_DOC] })).toEqual([]);
  });
  it("keeps canonical current doc linkage valid across ingest-time node stamps", async () => {
    hasLegend(await retrieve(question(OWN), [OTHER_NODE_DOC]), OTHER_NODE_DOC);
  });
  it("enforces explicit node scope when current canonical linkage was not validated", async () => {
    expect(await retrieve(question(OWN), [OTHER_NODE_DOC], { validatedDocScope: false })).toEqual([]);
  });
  it("never serves a specifically different fictional sibling manual", async () => {
    expect(await retrieve(question(OWN), [SIBLING_DOC])).toEqual([]);
  });
  it("an unknown/candidate notebook record does not become a confirmed table discriminator", async () => {
    const hits = await retrieve("Which fictional indicator legend applies?", [TABLE_SIBLING], {
      ...knownRecord(KNOWN), identityStatus: "candidate", catalogNumber: null,
    });
    hasLegend(hits, TABLE_SIBLING);
  });
});
