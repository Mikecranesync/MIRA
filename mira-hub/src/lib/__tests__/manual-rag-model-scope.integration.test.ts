/**
 * #3966/#3970: exercise the actual BM25 SQL against a disposable Postgres.
 * The integration connection gets a TEMP knowledge_entries table, so no
 * persistent corpus row or schema is created or changed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveManualChunks, retrieveNodeChunks } from "../manual-rag";
import { inferEquipmentType } from "../equipment-type";

const TENANT = "39700000-0000-4000-8000-000000000001";
let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("A confirmed disposable TEST_DATABASE_URL is required");
  }
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE knowledge_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      content text NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      manufacturer text NOT NULL,
      model_number text NOT NULL,
      source_url text NOT NULL,
      source_page integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      verified boolean NOT NULL DEFAULT true,
      is_private boolean NOT NULL DEFAULT false,
      doc_id uuid,
      ingest_route text,
      page_start integer,
      section_path text
    ) ON COMMIT DROP
  `);
  for (const model of [
    "TP700", "TP700 Comfort", "KTP700", "TP7000", "TP7001", "SINAMICS V20",
    "TP1200", "TP 1200 Comfort", "SIMATIC TP 1200", "KTP1200", "KTP 1200", "TP12000",
    "KTP70", "KTP 70", "KTP7000", "V20", "SINAMICS V 20", "V200", "XV20", "V 200",
    "PowerFlex 525", "PowerFlex 5250", "AX%_7", "AXZZ7", "AX.7", "AXZ7",
    "12AX%_7", "12AXZZ7",
  ]) {
    await client.query(
      `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url, is_private)
       VALUES ($1, 'panel supply specification', 'Siemens', $2, $3, false)`,
      [TENANT, model, `https://test.invalid/${encodeURIComponent(model)}`],
    );
  }
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  if (pool) await pool.end();
});

async function modelsFor(model: string): Promise<string[]> {
  const hits = await retrieveManualChunks(client, TENANT, "panel supply", {
    manufacturer: "Siemens", model, equipmentType: inferEquipmentType({ modelNumber: model, title: model }), topK: 20,
  });
  return hits.map((hit) => hit.modelNumber).sort();
}

describe("identity-bound OEM model SQL", () => {
  it("uses the opening page of opaque-named notebook manuals to reject sibling-model evidence", async () => {
    const doc810 = "39700000-0000-4000-8000-000000000081";
    const doc820 = "39700000-0000-4000-8000-000000000082";
    for (const [doc, model] of [[doc810, "Micro810"], [doc820, "Micro820"]]) {
      for (const [page, content] of [[1, `${model} Programmable Controllers User Manual`], [12, "Configure communication settings in controller properties."]] as const) {
        await client.query(
          `INSERT INTO knowledge_entries
            (tenant_id, content, manufacturer, model_number, source_url, page_start,
             doc_id, ingest_route, metadata, verified, is_private)
           VALUES ($1, $2, '', '', 'https://test.invalid/2080.pdf', $3, $4, 'v2',
             '{"node_id":"pilot-model","filename":"2080-publication.pdf","chunk_index":0}', true, true)`,
          [TENANT, content, page, doc],
        );
      }
    }
    const retrieve = (docIds: string[]) => retrieveNodeChunks(client, TENANT, "Micro820 communication settings", {
      nodeId: "pilot-model", unsPath: null, docIds, validatedDocScope: true,
    });
    expect(await retrieve([doc810])).toEqual([]);
    const hits = await retrieve([doc810, doc820]);
    expect(hits.some((hit) => hit.docId === doc820 && hit.sourcePage === 12)).toBe(true);
    expect(hits.every((hit) => hit.docId === doc820)).toBe(true);
    // More than one candidate window of high-ranking wrong-manual pages must
    // not hide a valid later page from the other attached manual.
    for (let page = 2; page < 40; page++) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, 'Micro820 communication settings communication settings communication settings',
           '', '', 'https://test.invalid/2080.pdf', $2, $3, 'v2',
           '{"node_id":"pilot-model","filename":"2080-publication.pdf"}', true, true)`,
        [TENANT, page, doc810],
      );
    }
    const crowded = await retrieve([doc810, doc820]);
    expect(crowded.some((hit) => hit.docId === doc820 && hit.sourcePage === 12)).toBe(true);
    expect(crowded.every((hit) => hit.docId === doc820)).toBe(true);
  });

  // #4469 F1: against the real BM25 SQL (not a mocked row), a plain numeric
  // model token ("800") collides across unrelated families — ACS800 and
  // Micro800 both reduce to "800" — so an ACS800-only notebook must not
  // answer a Micro800 question and vice versa.
  it("does not let an ACS800 manual answer a Micro800 question over real SQL (#4469 F1)", async () => {
    const docAcs = "39700000-0000-4000-8000-0000000000a8";
    const docMicro = "39700000-0000-4000-8000-0000000000a9";
    for (const [doc, heading, content] of [
      [docAcs, "ACS800 User Manual", "ACS800 communication settings are configured on the control panel."],
      [docMicro, "Micro800 User Manual", "Micro800 communication settings are configured on the control panel."],
    ] as const) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-f1.pdf', 1, $3, 'v2',
           $4::jsonb, true, true)`,
        [TENANT, `${heading}. ${content}`, doc, JSON.stringify({ node_id: "pilot-f1", filename: `${heading}.pdf` })],
      );
    }
    const retrieve = (docIds: string[], question: string) =>
      retrieveNodeChunks(client, TENANT, question, { nodeId: "pilot-f1", unsPath: null, docIds, validatedDocScope: true });
    expect(await retrieve([docAcs], "Micro800 communication settings")).toEqual([]);
    expect(await retrieve([docMicro], "ACS800 communication settings")).toEqual([]);
    expect(await retrieve([docAcs], "ACS800 communication settings")).toHaveLength(1);
    expect(await retrieve([docMicro], "Micro800 communication settings")).toHaveLength(1);
  });

  // #4469 F2 (primary review, pass 2): no finite keyword list can recognize
  // every way a document points away from itself — each of the primary
  // review's named phrasings, plus a renamed/mismatched filename, must
  // abstain over the real BM25 SQL, while a heading that genuinely covers
  // both models in one breath must still work, and a mismatched filename
  // must never override what the heading affirmatively declares.
  it("rejects every named cross-reference/exclusion phrasing as coverage over real SQL (#4469 F2)", async () => {
    const seeDoc = "39700000-0000-4000-8000-0000000000b1";
    const relatedDoc = "39700000-0000-4000-8000-0000000000b3";
    const excludedDoc = "39700000-0000-4000-8000-0000000000b4";
    const renamedDoc = "39700000-0000-4000-8000-0000000000b5";
    const bothDoc = "39700000-0000-4000-8000-0000000000b2";
    const rows: Array<[string, string, string, string]> = [
      [seeDoc, "2080-um010.pdf", "Micro810 User Manual. See the separate Micro820 manual.",
        "Configure the communication settings in the controller properties dialog."],
      [relatedDoc, "2080-um012.pdf", "Micro810 User Manual\nRelated documents: Micro820 user manual",
        "Configure the communication settings in the controller properties dialog."],
      [excludedDoc, "2080-um013.pdf", "Micro810 User Manual. Micro820 is not covered by this manual.",
        "Configure the communication settings in the controller properties dialog."],
      [renamedDoc, "Micro820_User_Manual.pdf", "Micro810 Programmable Controllers User Manual",
        "Configure the communication settings in the controller properties dialog."],
      [bothDoc, "2080-um011.pdf", "Micro810 and Micro820 Programmable Controllers User Manual",
        "Configure the communication settings in the controller properties dialog."],
    ];
    for (const [doc, filename, heading, body] of rows) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-f2.pdf', 1, $3, 'v2', $4::jsonb, true, true)`,
        [TENANT, `${heading}\n${body}`, doc, JSON.stringify({ node_id: "pilot-f2", filename })],
      );
    }
    const retrieve = (docIds: string[], question: string) =>
      retrieveNodeChunks(client, TENANT, question, { nodeId: "pilot-f2", unsPath: null, docIds, validatedDocScope: true });
    // Reject: none of these affirmatively declare Micro820 coverage.
    expect(await retrieve([seeDoc], "Micro820 communication settings")).toEqual([]);
    expect(await retrieve([relatedDoc], "Micro820 communication settings")).toEqual([]);
    expect(await retrieve([excludedDoc], "Micro820 communication settings")).toEqual([]);
    expect(await retrieve([renamedDoc], "Micro820 communication settings")).toEqual([]);
    // Control: each doc still answers the Micro810 question its own heading declares.
    expect(await retrieve([seeDoc], "Micro810 communication settings")).toHaveLength(1);
    expect(await retrieve([relatedDoc], "Micro810 communication settings")).toHaveLength(1);
    expect(await retrieve([excludedDoc], "Micro810 communication settings")).toHaveLength(1);
    expect(await retrieve([renamedDoc], "Micro810 communication settings")).toHaveLength(1);
    // Explicit multi-model coverage is retained.
    expect(await retrieve([bothDoc], "Micro820 communication settings")).toHaveLength(1);
  });

  // #4469 F1 (primary review, pass 2): "Comfort" alone is a panel FAMILY
  // hint, not a specific sibling model — a TP1200-Comfort-titled manual must
  // not answer a TP700 Comfort question over the real BM25 SQL.
  it("does not let a TP1200 Comfort manual answer a TP700 Comfort question over real SQL (#4469 F1)", async () => {
    const tp700Doc = "39700000-0000-4000-8000-0000000000d4";
    const tp1200Doc = "39700000-0000-4000-8000-0000000000d5";
    for (const [doc, model] of [[tp700Doc, "TP700"], [tp1200Doc, "TP1200"]] as const) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-f1-comfort.pdf', 1, $3, 'v2', $4::jsonb, true, true)`,
        [
          TENANT,
          `${model} Comfort Operating Instructions\n${model} Comfort supply voltage is 24 VDC.`,
          doc,
          JSON.stringify({ node_id: "pilot-f1-comfort", filename: `${model} Comfort Operating Instructions.pdf` }),
        ],
      );
    }
    const retrieve = (docIds: string[], question: string) =>
      retrieveNodeChunks(client, TENANT, question, { nodeId: "pilot-f1-comfort", unsPath: null, docIds, validatedDocScope: true });
    expect(await retrieve([tp1200Doc], "TP700 Comfort supply voltage")).toEqual([]);
    expect(await retrieve([tp700Doc], "TP700 Comfort supply voltage")).toHaveLength(1);
  });

  // #4469 F3: title normalization replaced catalog hyphens with spaces,
  // truncating a Siemens order number to its prefix before model-token
  // matching ran. Over the real BM25 SQL, the exact number must survive and
  // a different suffix sharing the same prefix must still be rejected.
  it("preserves an exact Siemens catalog number through title normalization over real SQL (#4469 F3)", async () => {
    const exactDoc = "39700000-0000-4000-8000-0000000000c1";
    const suffixDoc = "39700000-0000-4000-8000-0000000000c2";
    for (const [doc, catalog] of [
      [exactDoc, "6AV2124-0GC01-0AX0"],
      [suffixDoc, "6AV2124-0GC01-9AX0"],
    ] as const) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-f3.pdf', 1, $3, 'v2', $4::jsonb, true, true)`,
        [
          TENANT,
          `SIMATIC Panel ${catalog} Specification. Supply voltage: 24 VDC, rated current 500 mA.`,
          doc,
          JSON.stringify({ node_id: "pilot-f3", filename: `${catalog}.pdf` }),
        ],
      );
    }
    const retrieve = (docIds: string[]) =>
      retrieveNodeChunks(client, TENANT, "6AV2124-0GC01-0AX0 supply voltage", {
        nodeId: "pilot-f3", unsPath: null, docIds, validatedDocScope: true,
      });
    expect(await retrieve([exactDoc])).toHaveLength(1);
    expect(await retrieve([suffixDoc])).toEqual([]);
  });

  // #4469 F3 (primary review, pass 2): the catalog pattern is greedy enough
  // to swallow a file extension, so the filename-FALLBACK path (heading
  // names no model) must strip it before matching over the real BM25 SQL.
  it("preserves an exact catalog number through the FILENAME fallback over real SQL (#4469 F3)", async () => {
    const exactDoc = "39700000-0000-4000-8000-0000000000c3";
    const suffixDoc = "39700000-0000-4000-8000-0000000000c4";
    for (const [doc, catalog] of [
      [exactDoc, "6AV2124-0GC01-0AX0"],
      [suffixDoc, "6AV2124-0GC01-9AX0"],
    ] as const) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-f3b.pdf', 1, $3, 'v2', $4::jsonb, true, true)`,
        [
          TENANT,
          "Panel Specification Sheet. Supply voltage: 24 VDC, rated current 500 mA.",
          doc,
          JSON.stringify({ node_id: "pilot-f3b", filename: `${catalog}.pdf` }),
        ],
      );
    }
    const retrieve = (docIds: string[]) =>
      retrieveNodeChunks(client, TENANT, "6AV2124-0GC01-0AX0 supply voltage", {
        nodeId: "pilot-f3b", unsPath: null, docIds, validatedDocScope: true,
      });
    expect(await retrieve([exactDoc])).toHaveLength(1);
    expect(await retrieve([suffixDoc])).toEqual([]);
  });

  it("admits TP700 and TP700 Comfort, never KTP700, TP7000, TP7001, or V20", async () => {
    expect(await modelsFor("TP700")).toEqual(["TP700", "TP700 Comfort"]);
  });

  it("still retrieves the numeric legacy model token within PowerFlex 525", async () => {
    expect(await modelsFor("525")).toEqual(["PowerFlex 525"]);
  });

  it("matches compact and spaced TP1200 labels without admitting sibling models", async () => {
    expect(await modelsFor("TP1200")).toEqual(["SIMATIC TP 1200", "TP 1200 Comfort", "TP1200"]);
    expect(await modelsFor("TP 1200 Comfort")).toEqual(["SIMATIC TP 1200", "TP 1200 Comfort", "TP1200"]);
  });

  it("uses the real family classifier for spaced SIMATIC caller and corpus labels", async () => {
    expect(await modelsFor("SIMATIC TP 1200")).toEqual(["SIMATIC TP 1200", "TP 1200 Comfort", "TP1200"]);
    expect(await modelsFor("TP1200")).toEqual(["SIMATIC TP 1200", "TP 1200 Comfort", "TP1200"]);
  });

  it("matches every accepted spaced panel/drive token with its compact corpus form", async () => {
    for (const model of ["KTP70", "KTP 70"]) {
      expect(await modelsFor(model)).toEqual(["KTP 70", "KTP70"]);
    }
    for (const model of ["V20", "SINAMICS V20", "SINAMICS V 20"]) {
      expect(await modelsFor(model)).toEqual(["SINAMICS V 20", "SINAMICS V20", "V20"]);
    }
  });

  it("treats unknown percent, underscore, and regex punctuation as literal identity", async () => {
    expect(await modelsFor("AX%_7")).toEqual(["AX%_7"]);
    expect(await modelsFor("AX.7")).toEqual(["AX.7"]);
    expect(await modelsFor("12AX%_7")).toEqual(["12AX%_7"]);
  });
});

// Golden Walk 2026-10-04: acquired manuals held the asked code verbatim, but the
// page never reached the excerpts. Mitsubishi's question shares no other word
// with its fault table, and a Portuguese ABB manual shares none either — only
// the whole-token code lane can surface them. The decoy pins the "whole token"
// half: "removal" must not be admitted as the code "ovA". (ALARM 7 vs ALARM 70
// is a ranking property — the word "alarm" admits both via BM25 — and is pinned
// in notebook-query.test.ts.)
describe("notebook retrieval surfaces the fault code the question names", () => {
  const NB_TENANT = "39700000-0000-4000-8000-000000000003";
  const DOC = "39700000-0000-4000-8000-0000000000d1";
  const PT_DOC = "39700000-0000-4000-8000-0000000000d2";
  const DECOY_DOC = "39700000-0000-4000-8000-0000000000d3";

  async function seed(doc: string, page: number, content: string) {
    await client.query(
      `INSERT INTO knowledge_entries
         (tenant_id, content, manufacturer, model_number, source_url, source_page, page_start,
          doc_id, ingest_route, metadata, verified, is_private)
       VALUES ($1, $2, '', '', 'https://test.invalid/m.pdf', $3, $3, $4, 'v2', '{"node_id":"n1"}', true, true)`,
      [NB_TENANT, content, page, doc],
    );
  }
  async function pagesFor(doc: string, question: string) {
    const hits = await retrieveNodeChunks(client, NB_TENANT, question, {
      nodeId: "n1", unsPath: null, topK: 6, docIds: [doc], rawQuery: question,
      validatedDocScope: true, approvedSourceDocIds: [doc],
    });
    return hits.map((h) => h.sourcePage);
  }

  beforeAll(async () => {
    for (let p = 1; p <= 30; p++) {
      await seed(DOC, p, `The inverter output mean value on page ${p}. Set the inverter parameter and check the inverter display.`);
    }
    await seed(DOC, 15, "(H12) 24\nE.OV1\nRegenerative\novervoltage trip\nduring acceleration");
    for (let p = 1; p <= 40; p++) {
      await seed(PT_DOC, p, `Página ${p}. A falha do inversor pode ser redefinida pelo painel. Parâmetro ${p} define o drive quando ocorre uma falha.`);
    }
    for (let p = 1; p <= 10; p++) await seed(DECOY_DOC, p, `Cooling specification table ${p}.`);
    await seed(DECOY_DOC, 70, "Cover removal: lift the cover clear of the terminal block.");
    await seed(PT_DOC, 540, "Código Causa\n2310 Sobrecorrente\n3210 Sobretensão do barramento CC\n3220 Subtensão");
  });

  it("finds a dotted code that shares no other word with its page", async () => {
    expect((await pagesFor(DOC, "What does E.OV1 mean on this inverter"))[0]).toBe(15);
  });

  it("finds a numeric code in a manual written in another language", async () => {
    expect((await pagesFor(PT_DOC, "What does fault 3210 mean on this drive"))[0]).toBe(540);
  });

  it("never admits a word that merely contains the code", async () => {
    expect(await pagesFor(DECOY_DOC, "What does fault ovA mean on this drive")).not.toContain(70);
  });
});

// Defect A (#4224, quickstart half): #4236 gave retrieveNodeChunks (notebook) a
// whole-token code lane, but the anonymous /quickstart/ask surface calls
// retrieveManualChunks → runBm25Query, which had none. So a public OEM manual
// holding the asked code verbatim lost to pages that matched the question's
// OTHER words — the stranger-walk's "right manual, 'not in the excerpts'".
// These mirror the notebook block above on the manufacturer-scoped OEM surface.
describe("quickstart retrieval surfaces the fault code the question names", () => {
  const MFR = "Mitsubishi";
  const MODEL = "FR-E800";
  const DECOY_MFR = "Danfoss";

  async function seedMfr(mfr: string, model: string, page: number, content: string) {
    await client.query(
      `INSERT INTO knowledge_entries
         (tenant_id, content, manufacturer, model_number, source_url, source_page, verified, is_private)
       VALUES ($1, $2, $3, $4, $5, $6, true, false)`,
      [TENANT, content, mfr, model, `https://test.invalid/${encodeURIComponent(mfr)}.pdf`, page],
    );
  }
  async function pagesFor(question: string, mfr: string, allowTenantFallback = true) {
    const hits = await retrieveManualChunks(client, TENANT, question, {
      manufacturer: mfr,
      topK: 6,
      allowTenantFallback,
    });
    return hits.map((h) => h.sourcePage);
  }

  beforeAll(async () => {
    // 30 distractor pages rich in the question's ordinary words (inverter, mean,
    // fault) so BM25 ranks them above the code page.
    for (let p = 1; p <= 30; p++) {
      await seedMfr(
        MFR, MODEL, p,
        `The inverter output mean value on page ${p}. Set the inverter parameter and check the inverter display when a fault occurs.`,
      );
    }
    // The answer page — the dotted code shares no other word with the question.
    await seedMfr(MFR, MODEL, 15, "(H12) 24\nE.OV1\nRegenerative\novervoltage trip\nduring acceleration");
    // A different vendor's page that merely CONTAINS the ovA substring ("removal").
    await seedMfr(DECOY_MFR, "FC-51", 70, "Cover removal: lift the cover clear of the terminal block.");
    // The decoy vendor's OWN code page, so the manufacturer-scope control below
    // returns a real (non-empty) Danfoss hit rather than passing on emptiness.
    await seedMfr(DECOY_MFR, "FC-51", 42, "Alarm 7\nDC-link overvoltage detected on the drive.");
    // A THIRD vendor whose page documents the SAME code string ("Alarm 7"). This
    // is the row the manufacturer scope must exclude: it matches the code token
    // verbatim, so only the scope clause keeps it out of a Danfoss-scoped answer.
    // Drop the code lane's scope clauses and this page leaks — that is what makes
    // the scope assertion below load-bearing rather than trivially true.
    await seedMfr("Yaskawa", "GA500", 88, "Alarm 7\nOverload trip on the drive output stage.");
  });

  it("finds a dotted fault code that shares no other word with its page", async () => {
    expect(await pagesFor("What does E.OV1 mean on this inverter", MFR)).toContain(15);
  });

  it("never admits a word that merely contains the code (whole-token, not ILIKE substring)", async () => {
    expect(await pagesFor("What does fault ovA mean on this drive", DECOY_MFR)).not.toContain(70);
  });

  it("keeps the code lane manufacturer-scoped — no cross-vendor code hit", async () => {
    // Within a manufacturer-scoped call the code lane carries the SAME mfr/model/
    // family clauses as the BM25 passes, so a wrong-vendor code page cannot leak
    // in. Fallback OFF isolates that invariant from retrieveManualChunks' separate
    // tenant-wide fallback (which, by design, widens to the whole OEM corpus when
    // the named maker has no coverage — the route's stripConflictingVendors, not
    // this lane, is what prunes cross-vendor rows after that widening).
    // Ask the Danfoss drive for "Alarm 7": the lane surfaces Danfoss's own page 42
    // (proving it works, not just that the result is empty) and must EXCLUDE the
    // Yaskawa page 88 that documents the identical code string. Page 88 is the
    // load-bearing assertion — it matches the code token verbatim, so only the
    // scope clause keeps it out; drop the clause and 88 leaks.
    const danfoss = await pagesFor("What does Alarm 7 mean on this drive", DECOY_MFR, false);
    expect(danfoss).toContain(42);
    expect(danfoss).not.toContain(88);
  });
});

// #3331 / #4373 Codex R1 F1: rows tied on rank, source_url, source_page and
// chunk_index must still resolve in one fixed order, so the same question cites
// the same chunk every time. chunk_index is not unique (public rows span tenants;
// it may be null), so the primary key is the final discriminator. Each case uses
// its own vocabulary so it cannot match this file's other rows.
describe("tied rows resolve by primary key (#4373 R1 F1)", () => {
  const OTHER_TENANT = "39700000-0000-4000-8000-0000000000bb";
  const LOW_ID = "00000000-0000-4000-8000-0000000000a1";
  const HIGH_ID = "00000000-0000-4000-8000-0000000000a2";
  let n = 0;

  /** Insert the HIGH id first, so physical order alone would return it. */
  async function seedTie(term: string, metadata: object, tenants: [string, string]) {
    n += 1;
    for (const [id, tenant, model] of [
      [HIGH_ID.replace(/a2$/, `${n}2`), tenants[1], "TIE-HIGH"],
      [LOW_ID.replace(/a1$/, `${n}1`), tenants[0], "TIE-LOW"],
    ]) {
      await client.query(
        `INSERT INTO knowledge_entries (id, tenant_id, content, manufacturer, model_number, source_url, source_page, metadata, is_private)
         VALUES ($1, $2, $3, 'Tiebreak Co', $4, $5, 7, $6::jsonb, false)`,
        [id, tenant, `${term} specification`, model, `https://test.invalid/tie-${n}.pdf`, JSON.stringify(metadata)],
      );
    }
  }

  async function topOne(term: string): Promise<string | undefined> {
    const hits = await retrieveManualChunks(client, TENANT, term, { topK: 1 });
    expect(hits).toHaveLength(1);
    return hits[0]?.modelNumber;
  }

  it("same chunk_index under two public tenants: the lower id wins", async () => {
    await seedTie("gearbox lubricant", { chunk_index: 3 }, [TENANT, OTHER_TENANT]);
    expect(await topOne("gearbox lubricant")).toBe("TIE-LOW");
  });

  it("no chunk_index at all: the lower id wins", async () => {
    await seedTie("bearing grease", {}, [TENANT, TENANT]);
    expect(await topOne("bearing grease")).toBe("TIE-LOW");
  });

  it("the answer is identical across repeated runs", async () => {
    await seedTie("coupling alignment", {}, [TENANT, OTHER_TENANT]);
    const runs = new Set<string | undefined>();
    for (let i = 0; i < 5; i++) runs.add(await topOne("coupling alignment"));
    expect([...runs]).toEqual(["TIE-LOW"]);
  });
});

// #4373 Codex R3 F1: the notebook lane (retrieveNodeChunks) had the same gap —
// two same-page chunks of one document tie on doc_id/page_start/source_page and
// rank, so database order picked the cited excerpt. Ends on `id` too.
describe("notebook lane: tied same-page chunks resolve by primary key (#4373 R3 F1)", () => {
  const NB = "39700000-0000-4000-8000-0000000000cc";
  const DOC_T = "39700000-0000-4000-8000-0000000000d9";
  const LOW = "00000000-0000-4000-8000-0000000000e1";
  const HIGH = "00000000-0000-4000-8000-0000000000e2";

  beforeAll(async () => {
    // HIGH id first, so physical order alone would return it.
    for (const [id, file] of [[HIGH, "HIGH.pdf"], [LOW, "LOW.pdf"]]) {
      await client.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, content, manufacturer, model_number, source_url, source_page, page_start,
            doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, 'gearbox oil level sight glass', '', '', 'https://test.invalid/t.pdf', 4, 4, $3, 'v2', $4::jsonb, true, true)`,
        [id, NB, DOC_T, JSON.stringify({ node_id: "n9", filename: file })],
      );
    }
  });

  async function topFile(): Promise<string> {
    const hits = await retrieveNodeChunks(client, NB, "gearbox oil level", {
      nodeId: "n9", unsPath: null, topK: 1, docIds: [DOC_T], rawQuery: "gearbox oil level",
      validatedDocScope: true, approvedSourceDocIds: [DOC_T],
    });
    expect(hits).toHaveLength(1);
    return JSON.stringify(hits[0]);
  }

  it("the lower id wins, every time", async () => {
    for (let i = 0; i < 5; i++) expect(await topFile()).toContain("LOW.pdf");
  });
});
