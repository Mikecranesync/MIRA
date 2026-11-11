import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type PoolClient } from "pg";
import { retrieveNodeChunks } from "@/lib/manual-rag";
import { PHOTO_OCR_OPENER_START, PHOTO_READING_BODY_MARK, PHOTO_READING_OPENER } from "@/capabilities/photo-document-text";

const TENANT = "52940000-0000-4000-8000-000000000001";
const MANUAL = "52940000-0000-4000-8000-000000000011";
const CONTROLLER = "52940000-0000-4000-8000-000000000012";
const MOTOR = "52940000-0000-4000-8000-000000000013";
const COVER_CONTROL = "52940000-0000-4000-8000-000000000014";
const UNREVIEWED = "52940000-0000-4000-8000-000000000015";
const OTHER_ASSET = "52940000-0000-4000-8000-000000000016";
const TYPED_FILE = "52940000-0000-4000-8000-000000000017";
const OCR_DOC = "52940000-0000-4000-8000-000000000018";
const OTHER_TENANT = "52940000-0000-4000-8000-000000000099";
const DOCS = [MANUAL, CONTROLLER, MOTOR];
const QUESTION = "Which components of CV-101 have reviewed photo readings saved in this project? Summarize them with their source evidence. Distinguish nameplate ratings from live measurements, and list what is still unknown. Do not invent completed work.";
const PHOTO_HEADER = "Photo source: technician photo\nMachine: CV-101\nEvidence: technician-reviewed transcription of this photo. Review confirms the text, not a diagnosis or authorization to operate equipment.\nWhat the photo shows:\n";
const CONTROLLER_TEXT = PHOTO_HEADER + "Controller Micro820, catalog 2080-LC20-20QBB. Reviewed against the photo only; physical condition and operating state unknown. No completed work or live measurements.";
const MOTOR_TEXT = PHOTO_HEADER + "Motor model 108074; nameplate ratings: 1 HP, 230/460 V, 3.8/1.9 A, 60 Hz, 1725 RPM. Manufacturer unknown. Ratings are not measured operating values; installation and matching manual unverified.";
let client: Client;

async function seed(doc: string, page: number | null, content: string, chunk = 0, verified = false, tenant = TENANT, extra: Record<string, unknown> = {}) {
  await client.query(`INSERT INTO knowledge_entries
    (tenant_id,doc_id,content,source_url,source_page,page_start,metadata,verified,is_private,ingest_route)
    VALUES ($1,$2,$3,$4,$5,$5,$6::jsonb,$7,true,'v2')`,
  [tenant,doc,content,`https://test.invalid/${doc}.pdf`,page,
    JSON.stringify({node_id:"cv101-photo-recall",filename:doc === MANUAL ? "GS10 User Manual.pdf" : doc === COVER_CONTROL ? "PowerFlex 40 User Manual.pdf" : "Technician-reviewed photo reading.txt",chunk_index:chunk,...extra}),verified]);
}

/** The upload record the product makes when IT writes a document (a kept photo
 *  reading, a confirmed nameplate). Retrieval reads a photo-shaped text as a
 *  reading only when this record names it; an uploaded file has `user_upload`. */
async function record(doc: string, source: string, tenant = TENANT) {
  await client.query("INSERT INTO namespace_direct_uploads (tenant_id,upload_id,source) VALUES ($1,$2,$3)",[tenant,doc,source]);
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
  // Shadows the real table where the database has one, so the test reads only
  // the records it makes itself.
  await client.query(`CREATE TEMP TABLE namespace_direct_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, upload_id uuid,
    source text NOT NULL DEFAULT 'user_upload'
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
  // The saved readings above were written by the product, which records that.
  for (const doc of [CONTROLLER,MOTOR,OTHER_ASSET]) await record(doc,"photo_text");
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

async function retrieve(query = QUESTION, docIds = DOCS, approved = docIds, tenant = TENANT, rewrite: (sql:string)=>string = (sql)=>sql) {
  const idfRows: Array<{lex:string;names_document:boolean}> = [];
  const wrapped = { query: async (rawSql:string,params:unknown[]) => {
    const sql = rewrite(rawSql);
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

// Review round 1 on #5389. A photo reading is read by what was read off the
// photo, not by a cover. That rule was chosen by the document's own first line,
// which is ordinary text: a typed file could carry it above another model's
// cover. Who wrote a document now comes from the upload records.
describe("who wrote a photo-shaped document, over actual SQL", () => {
  const SIBLING_COVER = "Northfield RX410 Logic Controller\nHardware User Guide";
  const TYPED = `${PHOTO_READING_OPENER}\n${SIBLING_COVER}\n${PHOTO_READING_BODY_MARK}\nThis guide is sometimes kept beside the RX420 on the same line. Supply voltage 24 V DC.`;
  const OCR = `${PHOTO_OCR_OPENER_START}line-2.jpg" (OCR, 90% confidence):\n${SIBLING_COVER}\nKept beside the RX420 on the same line. Supply voltage 24 V DC.`;
  const ASK_SIBLING = "RX420 supply voltage?";
  const cited = async (question: string, doc: string) => (await retrieve(question,[doc])).hits.map(h=>h.docId);

  it("a typed file that opens like a kept photo reading has no record, so its cover decides", async () => {
    await seed(TYPED_FILE,1,TYPED,0,true);
    await record(TYPED_FILE,"user_upload");
    expect(await cited(ASK_SIBLING,TYPED_FILE)).toEqual([]);
    // Not "refuse everything": it is still an upload, and answers for the model on its cover.
    expect(await cited("RX410 supply voltage?",TYPED_FILE)).toEqual([TYPED_FILE]);
  });

  it("with no upload row at all the same file is judged by its cover", async () => {
    await seed(TYPED_FILE,1,TYPED,0,true);
    expect(await cited(ASK_SIBLING,TYPED_FILE)).toEqual([]);
  });

  it("the same words in a document the records say the product wrote are a reading", async () => {
    await seed(TYPED_FILE,1,TYPED,0,true);
    await record(TYPED_FILE,"photo_text");
    expect(await cited(ASK_SIBLING,TYPED_FILE)).toEqual([TYPED_FILE]);
  });

  it.each([
    ["another tenant's record", "photo_text", OTHER_TENANT],
    ["a record of a different product-written kind", "nameplate_text", TENANT],
    ["a record of some other server-written kind", "manual_discovery", TENANT],
  ])("%s does not vouch for it", async (_name, source, tenant) => {
    await seed(TYPED_FILE,1,TYPED,0,true);
    await record(TYPED_FILE,source,tenant);
    expect(await cited(ASK_SIBLING,TYPED_FILE)).toEqual([]);
  });

  it("OCR-shaped text is a reading only when its passages carry the mark the upload route writes", async () => {
    await seed(OCR_DOC,1,OCR,0,true);
    expect(await cited(ASK_SIBLING,OCR_DOC)).toEqual([]);
    await client.query("DELETE FROM knowledge_entries WHERE doc_id=$1 AND tenant_id = $2 AND is_private = true",[OCR_DOC,TENANT]);
    await seed(OCR_DOC,1,OCR,0,true,TENANT,{derived_from:"photo_ocr"});
    expect(await cited(ASK_SIBLING,OCR_DOC)).toEqual([OCR_DOC]);
  });

  it("the mark on another tenant's passages, or an upload record, does not vouch for OCR-shaped text", async () => {
    await seed(OCR_DOC,1,OCR,0,true);
    await seed(OCR_DOC,1,OCR,0,true,OTHER_TENANT,{derived_from:"photo_ocr"});
    await record(OCR_DOC,"photo_text");
    expect(await cited(ASK_SIBLING,OCR_DOC)).toEqual([]);
  });

  it("a failed lookup leaves photo-shaped documents judged by their cover, and the rest of the search still runs", async () => {
    const warn = vi.spyOn(console,"warn").mockImplementation(() => undefined);
    const broken = (sql:string) => sql.includes("document-origin") ? "SELECT upload_id FROM no_such_table_for_the_origin_lookup" : sql;
    const {hits} = await retrieve(QUESTION,DOCS,DOCS,TENANT,broken);
    // The real statement failed inside the caller's transaction…
    expect(warn.mock.calls.some(c=>String(c[0]).includes("document-origin lookup failed"))).toBe(true);
    // …the saved readings are no longer vouched for, so the question's machine tag refuses them…
    expect(hits.map(h=>h.docId)).not.toContain(CONTROLLER);
    expect(hits.map(h=>h.docId)).not.toContain(MOTOR);
    // …and the lanes that came after it still ran on the same transaction.
    expect(hits.some(h=>h.docId===MANUAL)).toBe(true);
    expect((await client.query("SELECT 1 AS ok")).rows).toEqual([{ok:1}]);
    warn.mockRestore();
  });
});
