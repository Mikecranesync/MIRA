import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const TENANT = "52940000-0000-4000-8000-000000000001";
const MANUAL = "52940000-0000-4000-8000-000000000011";
const CONTROLLER = "52940000-0000-4000-8000-000000000012";
const MOTOR = "52940000-0000-4000-8000-000000000013";
const COVER_CONTROL = "52940000-0000-4000-8000-000000000014";
const UNREVIEWED = "52940000-0000-4000-8000-000000000015";
const OTHER_ASSET = "52940000-0000-4000-8000-000000000016";
const DOCS = [MANUAL, CONTROLLER, MOTOR];
const QUESTION = "Which components of CV-101 have reviewed photo readings saved in this project? Summarize them with their source evidence. Distinguish nameplate ratings from live measurements, and list what is still unknown. Do not invent completed work.";
const PHOTO_HEADER = "Photo source: technician photo\nMachine: CV-101\nEvidence: technician-reviewed transcription of this photo. Review confirms the text, not a diagnosis or authorization to operate equipment.\nWhat the photo shows:\n";
const CONTROLLER_TEXT = PHOTO_HEADER + "Controller Micro820, catalog 2080-LC20-20QBB. Reviewed against the photo only; physical condition and operating state unknown. No completed work or live measurements.";
const MOTOR_TEXT = PHOTO_HEADER + "Motor model 108074; nameplate ratings: 1 HP, 230/460 V, 3.8/1.9 A, 60 Hz, 1725 RPM. Manufacturer unknown. Ratings are not measured operating values; installation and matching manual unverified.";
let client: Client;

async function seed(doc: string, page: number | null, content: string, chunk = 0, verified = false, tenant = TENANT) {
  await client.query(`INSERT INTO knowledge_entries
    (tenant_id,doc_id,content,source_url,source_page,page_start,metadata,verified,is_private,ingest_route)
    VALUES ($1,$2,$3,$4,$5,$5,$6::jsonb,$7,true,'v2')`,
  [tenant,doc,content,`https://test.invalid/${doc}.pdf`,page,
    JSON.stringify({node_id:"cv101-photo-recall",filename:doc === MANUAL ? "GS10 User Manual.pdf" : doc === COVER_CONTROL ? "PowerFlex 40 User Manual.pdf" : "Technician-reviewed photo reading.txt",chunk_index:chunk}),verified]);
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") throw Error("Disposable local database required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw Error("Only loopback Postgres permitted");
  client = new Client({connectionString:url.href});
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout='5000ms'");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,doc_id uuid NOT NULL,
    content text NOT NULL,content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED,
    manufacturer text DEFAULT '',model_number text DEFAULT '',source_url text NOT NULL,
    source_page integer,page_start integer,section_path text,metadata jsonb NOT NULL,
    verified boolean NOT NULL,is_private boolean NOT NULL,ingest_route text NOT NULL
  ) ON COMMIT DROP`);
  await seed(MANUAL,1,"DURApulse GS10 User Manual");
  for (let page=5;page<15;page++) {
    await seed(MANUAL,page,"Components saved in a project. Summarize source evidence and list still unknown work. Complete work and distinguish live measurements. Project components, work completed and saved settings.");
  }
  await seed(CONTROLLER,1,CONTROLLER_TEXT,0,true);
  await seed(MOTOR,1,MOTOR_TEXT,0,true);
  await seed(COVER_CONTROL,1,"Allen-Bradley PowerFlex 40 User Manual",0,true);
  await seed(COVER_CONTROL,10,"Fault history: display the previous fault codes.",1,true);
  await seed(UNREVIEWED,1,"Photo source: technician photo. Unconfirmed transcription of motor nameplate ratings, not technician-verified.");
  await seed(OTHER_ASSET,1,PHOTO_HEADER+"OTHER ASSET MUST NOT APPEAR. Components reviewed and saved.",0,true);
});

afterAll(async () => { if (client) { await client.query("ROLLBACK"); await client.end(); } });
beforeEach(async () => {
  vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL","true");
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL","0");
  vi.stubEnv("NOTEBOOK_RERANK","0");
  vi.stubEnv("NOTEBOOK_LEXICAL_V2","0");
  vi.stubGlobal("fetch",vi.fn(() => { throw Error("No provider or scorer in this SQL fixture"); }));
  await client.query("SAVEPOINT test_case");
});
afterEach(async () => {
  await client.query("ROLLBACK TO SAVEPOINT test_case");
  await client.query("RELEASE SAVEPOINT test_case");
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();vi.unstubAllEnvs();
});

async function retrieve(query = QUESTION, docIds = DOCS, approved = docIds, tenant = TENANT) {
  const idfRows: Array<{lex:string;names_document:boolean}> = [];
  const wrapped = { query: async (sql:string,params:unknown[]) => {
    const result = await client.query(sql,params);
    if (sql.includes("SELECT df.lex, df.df")) idfRows.push(...result.rows);
    return result;
  } };
  const hits = await retrieveNodeChunks(wrapped as unknown as PoolClient,tenant,query,{
    nodeId:"cv101-photo-recall",unsPath:null,docIds,approvedSourceDocIds:approved,validatedDocScope:true,rawQuery:query,topK:6,
  });
  return {hits,idfRows};
}

describe("CV101 fresh-conversation photo recall over actual SQL", () => {
  it("the unchanged original question keeps both saved readings ahead of manual boilerplate", async () => {
    const {hits} = await retrieve();
    expect(hits.slice(0,3).map(h=>h.docId)).toEqual(expect.arrayContaining([CONTROLLER,MOTOR]));
    expect(hits.find(h=>h.docId===CONTROLLER)).toMatchObject({content:CONTROLLER_TEXT,sourcePage:1,verified:true});
    expect(hits.find(h=>h.docId===MOTOR)).toMatchObject({content:MOTOR_TEXT,sourcePage:1,verified:true});
  });

  it.each([1,null])("same-page or unlocated chunks do not turn photo text into a cover (extra page=%s)", async (page) => {
    await seed(CONTROLLER,page,"Additional reviewed photo reading details",1,true);
    const {idfRows} = await retrieve();
    expect(idfRows.find(r=>r.lex==="photo")?.names_document).toBe(false);
    expect(idfRows.find(r=>r.lex==="review")?.names_document).toBe(false);
  });

  it("still suppresses actual multi-page manual cover names, not their fault-history topic", async () => {
    const {hits,idfRows} = await retrieve("check fault history in Allen Bradley PowerFlex 40",[COVER_CONTROL]);
    expect(idfRows.find(r=>r.lex==="powerflex")?.names_document).toBe(true);
    expect(idfRows.find(r=>r.lex==="histori")?.names_document).toBe(false);
    expect(hits.some(h=>h.sourcePage===10)).toBe(true);
  });

  it("a one-page manual does not declare all its factual text to be a cover", async () => {
    await client.query("DELETE FROM knowledge_entries WHERE doc_id=$1 AND source_page=10 AND tenant_id = $2 AND is_private = true",[COVER_CONTROL,TENANT]);
    const {idfRows} = await retrieve("check fault history in Allen Bradley PowerFlex 40",[COVER_CONTROL]);
    expect(idfRows.find(r=>r.lex==="powerflex")?.names_document).toBe(false);
  });

  it("does not broaden the selected document boundary to a sibling asset", async () => {
    const {hits} = await retrieve();
    expect(hits.every(h=>DOCS.includes(h.docId!))).toBe(true);
    expect(hits.every(h=>!h.content.includes("OTHER ASSET"))).toBe(true);
  });

  it("identical copies within a document do not exhaust the result slots or delete indexed pages", async () => {
    const {hits} = await retrieve("components saved project",[MANUAL]);
    expect(new Set(hits.map(h=>h.content)).size).toBe(hits.length);
    expect(Number((await client.query("SELECT count(*) AS n FROM knowledge_entries WHERE doc_id=$1 AND tenant_id = $2 AND is_private = true",[MANUAL,TENANT])).rows[0].n)).toBe(11);
  });

  it("identical text in different selected documents keeps each source identity", async () => {
    await client.query("DELETE FROM knowledge_entries WHERE doc_id=ANY($1::uuid[]) AND tenant_id = $2 AND is_private = true",[[CONTROLLER,MOTOR],TENANT]);
    const same = "Saved photo reading: motor nameplate ratings are proposed, not measured values.";
    await seed(CONTROLLER,1,same,0,true);
    await seed(MOTOR,1,same,0,true);
    await client.query("UPDATE knowledge_entries SET source_url='https://test.invalid/shared-original.pdf' WHERE doc_id=ANY($1::uuid[]) AND tenant_id = $2 AND is_private = true",[[CONTROLLER,MOTOR],TENANT]);
    const {hits} = await retrieve("saved photo motor nameplate ratings",[CONTROLLER,MOTOR]);
    expect(hits.map(h=>h.docId).sort()).toEqual([CONTROLLER,MOTOR].sort());
    expect(hits.every(h=>h.content===same)).toBe(true);
  });

  it.each([1,2])("keeps different qualifiers and warnings when prefixes match (second page=%s)", async (page) => {
    await client.query("DELETE FROM knowledge_entries WHERE doc_id=$1 AND tenant_id = $2 AND is_private = true",[CONTROLLER,TENANT]);
    const prefix = "Motor photo nameplate documentation, reviewed text and ratings only. ";
    const a = prefix + "230 V rating; WARNING: isolate power before inspection.";
    const b = prefix + "460 V rating; WARNING: stored energy may remain.";
    await seed(CONTROLLER,1,a,0,true);
    await seed(CONTROLLER,page,b,1,true);
    const {hits} = await retrieve("motor photo nameplate ratings",[CONTROLLER]);
    expect(hits.map(h=>h.content)).toEqual(expect.arrayContaining([a,b]));
    expect(hits.map(h=>h.sourcePage).sort()).toEqual([1,page]);
  });

  it("does not admit an unapproved private reading", async () => {
    expect((await retrieve(QUESTION,[UNREVIEWED],[MANUAL])).hits).toEqual([]);
  });

  it("an explicitly selected unreviewed reading is not promoted to technician-verified", async () => {
    const {hits} = await retrieve(QUESTION,[UNREVIEWED]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h=>h.verified===false)).toBe(true);
  });

  it("does not read these private documents for a different tenant", async () => {
    expect((await retrieve(QUESTION,DOCS,DOCS,"52940000-0000-4000-8000-000000000099")).hits).toEqual([]);
  });

  it("keeps lexical-v2 on its existing scorer without the question-IDF feature", async () => {
    vi.stubEnv("NOTEBOOK_LEXICAL_V2","1");
    const {hits,idfRows} = await retrieve();
    expect(idfRows).toEqual([]);
    expect(hits.every(h=>DOCS.includes(h.docId!))).toBe(true);
    expect(hits.some(h=>h.docId===MOTOR)).toBe(true);
  });
});
