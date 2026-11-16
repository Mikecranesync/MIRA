/**
 * #3966/#3970: exercise the actual BM25 SQL against a disposable Postgres.
 * The integration connection gets a TEMP knowledge_entries table, so no
 * persistent corpus row or schema is created or changed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, Pool, type PoolClient } from "pg";
import { retrieveManualChunks, retrieveNodeChunks } from "../manual-rag";
import { inferEquipmentType } from "../equipment-type";

import fixture from "../../capabilities/__fixtures__/table-rows/micro820-in009-p16-20-scope.json";
import { COLUMN_LINE_MARK } from "@/capabilities/contact-ratings-table";
import { excludedTablesRefusalText } from "@/capabilities/manual-applicability";
import { boundaryMatrix, boundaryMatrixPages, measuredMatrix, measuredMatrixPage, columnBoundaryMatrix, columnBoundaryMatrixPages, columnSemanticMatrix, columnSemanticMatrixPages, columnMeasuredMatrix, columnMeasuredMatrixPage, columnMeasuredMatrixRules, columnMeasuredLaterQualified } from "@/capabilities/__fixtures__/section-boundary-matrix";


// #5503 PDF/tenant boundaries for the nested SQL block below; no search rows scripted.
vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
});
const db = vi.hoisted(() => ({ client: null as PoolClient | null, failLayoutPage: null as number | null, pages: null as Array<(typeof fixture.pages)[number] & { rules?: Array<{ x: number; y0: number; y1: number }> }> | null }));
// Pinned table rules (#5503 F14/F15): a captured page gets its source manual's real pin; a page a
// test builds may declare its own rules.
vi.mock("@/capabilities/table-rule-pins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/table-rule-pins")>();
  const { pinsDouble } = await import("../../capabilities/__fixtures__/pinned-rules-double");
  return { ...actual, rulePinsForSha: () => pinsDouble(actual, db.pages ?? fixture.pages, [fixture.sha256]) };
});
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    getPage: async (page: number) => ({
      getTextContent: async () => {
        if (db.failLayoutPage === page) throw new Error("simulated page layout read failure");
        return { items: ((db.pages ?? fixture.pages).find((p) => p.page === page)?.items ?? []).map((i) => ({
          str: i.str, width: i.w, transform: [i.size, 0, 0, i.size, i.x, i.y],
        })) };
      },
      cleanup: () => true,
    }),
  })),
  extractText: vi.fn(async () => ({ text: Array.from({ length: Math.max(20, ...(db.pages ?? fixture.pages).map((p) => p.page)) }, (_, i) => (db.pages ?? fixture.pages).find((p) => p.page === i + 1)?.text ?? "") })),
}));
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_tenant: string, fn: (client: PoolClient) => Promise<unknown>) => fn(db.client!)),
}));


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

  // Codex #4469 r2 F2/F5/F6 over the real BM25 SQL: a first-line
  // cross-reference never declares coverage, a wrapped dual-model title still
  // does, and an exact catalog number outranks a shared panel label.
  it("declared-title applicability over real SQL (Codex #4469 r2 F2/F5/F6)", async () => {
    const xrefDoc = "39700000-0000-4000-8000-0000000000e1";
    const wrappedDoc = "39700000-0000-4000-8000-0000000000e2";
    const catMatchDoc = "39700000-0000-4000-8000-0000000000e3";
    const catConflictDoc = "39700000-0000-4000-8000-0000000000e4";
    const body = "Configure the communication settings in the controller properties dialog.";
    const rows: Array<[string, string, string]> = [
      [xrefDoc, "2080-um020.pdf", `Micro810 User Manual \u2014 for Micro820 consult the separate manual\n${body}`],
      [wrappedDoc, "2080-um021.pdf", `Micro810 and\nMicro820 Programmable Controllers User Manual\n${body}`],
      [catMatchDoc, "spec-a.pdf", `TP700 Comfort 6AV2124-0GC01-0AX0 Specification\n${body}`],
      [catConflictDoc, "spec-b.pdf", `TP700 Comfort 6AV2124-0GC01-9AX0 Specification\n${body}`],
    ];
    for (const [doc, filename, content] of rows) {
      await client.query(
        `INSERT INTO knowledge_entries
          (tenant_id, content, manufacturer, model_number, source_url, page_start,
           doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/4469-r2.pdf', 1, $3, 'v2', $4::jsonb, true, true)`,
        [TENANT, content, doc, JSON.stringify({ node_id: "pilot-r2", filename })],
      );
    }
    const retrieve = (docIds: string[], question: string) =>
      retrieveNodeChunks(client, TENANT, question, { nodeId: "pilot-r2", unsPath: null, docIds, validatedDocScope: true });
    expect(await retrieve([xrefDoc], "Micro820 communication settings")).toEqual([]);
    expect(await retrieve([xrefDoc], "Micro810 communication settings")).toHaveLength(1);
    expect(await retrieve([wrappedDoc], "Micro820 communication settings")).toHaveLength(1);
    expect(await retrieve([wrappedDoc], "Micro810 communication settings")).toHaveLength(1);
    const catalogQ = "TP700 Comfort 6AV2124-0GC01-0AX0 communication settings";
    expect(await retrieve([catMatchDoc], catalogQ)).toHaveLength(1);
    expect(await retrieve([catConflictDoc], catalogQ)).toEqual([]);
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

// #4513 — IDF-sum lexical candidates (docs/specs/notebook-retrieval-idf-scoring.md),
// behind NOTEBOOK_LEXICAL_V2. Each fixture reproduces one measured miss mechanism
// from the 77-question harness in miniature, over real Postgres full-text SQL.
describe("notebook lexical IDF scoring (#4513, NOTEBOOK_LEXICAL_V2)", () => {
  const T = "39700000-0000-4000-8000-000000004513";
  const HIJACK = "39700000-0000-4000-8000-0000000045a1";
  const CHATTY = "39700000-0000-4000-8000-0000000045a2";
  const CODES = "39700000-0000-4000-8000-0000000045a3";
  const SIBLING = "39700000-0000-4000-8000-0000000045a4";
  const ISOLATED = "39700000-0000-4000-8000-0000000045a5";

  async function seed(doc: string, page: number, content: string) {
    await client.query(
      `INSERT INTO knowledge_entries
         (tenant_id, content, manufacturer, model_number, source_url, source_page, page_start,
          doc_id, ingest_route, metadata, verified, is_private)
       VALUES ($1, $2, '', '', 'https://test.invalid/idf.pdf', $3, $3, $4, 'v2', '{"node_id":"n4513"}', true, true)`,
      [T, content, page, doc],
    );
  }
  async function pages(doc: string, question: string, flag: boolean): Promise<Array<number | null>> {
    const prev = process.env.NOTEBOOK_LEXICAL_V2;
    if (flag) process.env.NOTEBOOK_LEXICAL_V2 = "1";
    else delete process.env.NOTEBOOK_LEXICAL_V2;
    try {
      const hits = await retrieveNodeChunks(client, T, question, {
        nodeId: "n4513", unsPath: null, topK: 6, docIds: [doc], rawQuery: question, validatedDocScope: true,
      });
      return hits.map((h) => h.sourcePage);
    } finally {
      if (prev === undefined) delete process.env.NOTEBOOK_LEXICAL_V2;
      else process.env.NOTEBOOK_LEXICAL_V2 = prev;
    }
  }

  // AND hijack (micro820-um-q3, ml1100-q3/q5): one wrong page happens to contain
  // every question word, so the all-words pass is non-empty and the any-words
  // ranking never runs. The answer page holds the rare words but not "controller".
  const HIJACK_Q = "what does a flashing red status light on the controller mean";
  // Chatty near-miss (gs10-ch6-q3, tq-12, tq-23): no page holds every word, and
  // pages dense in the common words ("drive", "show", "run") outrank the answer
  // page, which holds the rare words ("undervoltage", "stopping"). Wording avoids
  // the synonym triggers ("fault", "decel") that add extra OR passes on main.
  const CHATTY_Q = "why does my drive show undervoltage when stopping and how do I run it again";

  beforeAll(async () => {
    await seed(HIJACK, 3, "Mean time between failures for the controller. The red status light housing is flashing-resistant.");
    for (let p = 10; p <= 30; p++) {
      await seed(HIJACK, p, `Controller wiring page ${p}. Connect the controller to the controller power supply. Controller mounting.`);
    }
    await seed(HIJACK, 42, "Status lights. STATUS light flashing red: a recoverable error. Solid red: a non-recoverable error.");

    for (let p = 1; p <= 20; p++) {
      await seed(CHATTY, p, `The drive display will show the drive run status. Run the drive. The drive will show run. Drive page ${p}.`);
    }
    await seed(CHATTY, 57, "Undervoltage while stopping: lengthen the stopping ramp or add a braking resistor.");

    for (let p = 1; p <= 12; p++) await seed(CODES, p, `Fault list continued, page ${p}. Fault reset and fault history.`);
    await seed(CODES, 31, "F004 Undervoltage. Cause: DC bus voltage below the trip level.");
    await seed(CODES, 33, "P042 Decel Time 1. Range 0.1 to 600.0 s. Default 10.0 s.");
    await seed(CODES, 35, "Accel and decel ramp table. Units seconds. Default ramp shape linear.");

    await seed(ISOLATED, 1, "Cooling fan replacement for the enclosure.");
    await seed(ISOLATED, 2, "Enclosure fan airflow and filter cleaning interval.");
    await seed(ISOLATED, 3, "Terminal torque values for the enclosure.");
  });

  // Until the T-1 ranking fix (#4979) this test pinned the defect with the flag
  // off ("the AND hijack keeps the answer page out"). The production path now
  // finds the page too: the last-resort OR pass is keyed on lexical coverage and
  // the rerank weighs the question's rare words.
  it("the AND hijack no longer hides the answer page with the flag off either (T-1, #4979)", async () => {
    expect((await pages(HIJACK, HIJACK_Q, false)).slice(0, 6)).toContain(42);
  });

  it("the AND hijack no longer hides the answer page (invariant 4)", async () => {
    expect((await pages(HIJACK, HIJACK_Q, true)).slice(0, 6)).toContain(42);
  });

  it("a rare word outranks a repeated common one with the flag off too (T-1, #4979)", async () => {
    expect((await pages(CHATTY, CHATTY_Q, false)).slice(0, 6)).toContain(57);
  });

  it("a rare word outranks a repeated common one (invariant 3)", async () => {
    expect((await pages(CHATTY, CHATTY_Q, true))[0]).toBe(57);
  });

  it("control: a fault code still leads under the flag", async () => {
    expect((await pages(CODES, "what does F004 mean", true))[0]).toBe(31);
  });

  it("control: a parameter ask still leads under the flag", async () => {
    expect((await pages(CODES, "what is the default for P042", true))[0]).toBe(33);
  });

  it("control: a table ask still reaches its table under the flag", async () => {
    expect((await pages(CODES, "accel decel ramp table units", true)).slice(0, 6)).toContain(35);
  });

  it("no lexical match returns nothing, never front matter (invariant 2)", async () => {
    expect(await pages(ISOLATED, "zebra quantum banana", true)).toEqual([]);
  });

  it("a sibling document never leaks in or shifts the scores (invariant 1)", async () => {
    const q = "enclosure fan filter";
    const before = await pages(ISOLATED, q, true);
    // The sibling repeats one query word everywhere: if it fed df, "filter" would
    // stop being rare and the order inside ISOLATED could change.
    for (let p = 1; p <= 40; p++) await seed(SIBLING, p, "Filter filter filter. Enclosure fan filter cleaning.");
    const after = await pages(ISOLATED, q, true);
    expect(after).toEqual(before);
    expect(before[0]).toBe(2);
  });
});

// #5503 cases are collected by the existing Beta Gate OEM model-specificity selection.
// Existing32 bodies above and the moved13 body below are preserved verbatim.
describe("#5503 model-section applicability: actual upload and retrieval SQL", () => {
const TENANT = "55030000-0000-4000-8000-000000000001";
const OTHER_TENANT = "55030000-0000-4000-8000-000000000002";
const DOCUMENT = "55030000-0000-4000-8000-000000000010";
const NODE = "55030000-0000-4000-8000-000000000020";
let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL || process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("A confirmed disposable TEST_DATABASE_URL is required");
  }
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 2000 });
  client = await pool.connect();
  db.client = client;
  await client.query("BEGIN");
  await client.query(`CREATE TEMP TABLE knowledge_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL,
    source_type text, content text NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    manufacturer text NOT NULL DEFAULT '', model_number text NOT NULL DEFAULT '',
    source_url text NOT NULL, source_page integer, doc_id uuid, ingest_route text,
    page_start integer, page_end integer, section_path text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, verified boolean NOT NULL DEFAULT true,
    is_private boolean NOT NULL DEFAULT true
  ) ON COMMIT DROP`);
  await client.query(`CREATE UNIQUE INDEX f31_temp_chunk_unique ON knowledge_entries
    (tenant_id, source_url, ((metadata->>'chunk_index')::int))
    WHERE (metadata->>'chunk_index') IS NOT NULL`);
  const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
  await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
    filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
  // Same document/node identifiers on another tenant must not supply either a hit
  // or the header from which the current tenant's manual applicability is judged.
  await client.query(`INSERT INTO knowledge_entries
    (tenant_id, content, source_url, doc_id, ingest_route, page_start, metadata, is_private)
    VALUES ($1, 'foreignscope sentinel Micro810 relay contact ratings switching time analog output DC input surge current',
      'node-doc/foreign/manual.pdf', $2, 'v2', 1, $3::jsonb, true)`,
  [OTHER_TENANT, DOCUMENT, JSON.stringify({ node_id: NODE, filename: fixture.source })]);
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  db.client = null;
  if (pool) await pool.end();
});

async function retrieve(model: string, question: string) {
  const diagnostics: { excludedTables?: Array<{ page: number | null; models: string[]; section?: true; unqualified?: true }> } = {};
  const chunks = await retrieveNodeChunks(client, TENANT, question, {
    nodeId: NODE, unsPath: null, docIds: [DOCUMENT], validatedDocScope: true, topK: 100,
    identity: { manufacturer: "Allen-Bradley", model: "Micro820" }, identityStatus: "user_confirmed",
    catalogNumber: `2080-LC20-${model}`, diagnostics,
  });
  return { chunks, diagnostics, text: chunks.map((c) => c.content).join("\n") };
}

describe("#5503 actual upload INSERT through raw retrieval SQL", () => {
  it("the actual writer persists separated sections and #5487 lines with model scope", async () => {
    const result = await client.query(`SELECT content, page_start, metadata FROM knowledge_entries
      WHERE tenant_id = $1 AND page_start IN (18, 19)`, [TENANT]);
    const rows = result.rows.filter((r) => /Relay Output Specifications|Relay Contact Ratings|columns read from the page layout/.test(r.content));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.content.includes(COLUMN_LINE_MARK))).toBe(true);
    for (const row of rows) {
      expect(row.metadata.table_models).toEqual(expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]));
      expect(row.metadata.table_scope).toBe("section");
      expect(row.content).not.toMatch(/Analog Output Specifications|DC Input Specifications|DC Output Specifications/);
    }
  });
  it("QBB receives no relay-only rows or contact-rating columns and SQL reports their source pages", async () => {
    const contact = await retrieve("20QBB", "relay contact ratings 120 V AC");
    const output = await retrieve("20QBB", "relay output specifications switching time mechanical life");
    for (const result of [contact, output]) {
      expect(result.text).not.toMatch(/Relay Contact Ratings|Relay Output Specifications|Maximum switching time|10,000,000 cycles|columns read from the page layout/);
    }
    expect(contact.diagnostics.excludedTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 19, section: true, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
    ]));
    expect(output.diagnostics.excludedTables).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 18, section: true, models: expect.arrayContaining(["2080LC2020QWB", "2080LC2020AWB"]) }),
    ]));
  });
  for (const model of ["20QWB", "20AWB"]) {
    it(`${model} retains valid relay output and contact-rating evidence through actual SQL`, async () => {
      const contact = await retrieve(model, "relay contact ratings 120 V AC");
      const output = await retrieve(model, "relay output specifications switching time mechanical life");
      expect(contact.text).toContain(`${COLUMN_LINE_MARK}120 V AC row: make 15 A, break 1.5 A, continuous 2 A.`);
      expect(output.text).toContain("Maximum switching time");
      expect(output.text).toContain("10,000,000 cycles");
    });
  }
  for (const model of ["20QBB", "20QWB", "20AWB"]) {
    it(`${model} keeps shared analog-output evidence through actual SQL`, async () => {
      const result = await retrieve(model, "analog output voltage range");
      const analog = result.chunks.find((c) => /Analog Output Specifications/.test(c.content));
      expect(analog?.content).toContain("Output count range");
      expect(analog?.content).toContain("Channel-to-channel isolation");
      expect(analog?.content).not.toMatch(/Relay Contact Ratings|columns read from the page layout/);
    });
    it(`${model} keeps shared DC-input evidence despite sibling names in a subcolumn`, async () => {
      const result = await retrieve(model, "DC input specifications voltage category IEC compatibility");
      const input = result.chunks.find((c) => /DC Input Specifications/.test(c.content));
      expect(input?.content).toContain("IEC input compatibility");
      expect(input?.content).not.toMatch(/Relay Output Specifications|Maximum switching time/);
    });
  }
  it("DC-output evidence is available for QBB and excluded for QWB/AWB over SQL", async () => {
    const own = await retrieve("20QBB", "DC output specifications surge current per point");
    expect(own.text).toContain("DC Output Specifications");
    expect(own.text).toContain("Surge current per point");
    for (const model of ["20QWB", "20AWB"]) {
      const other = await retrieve(model, "DC output specifications surge current per point");
      expect(other.text).not.toMatch(/DC Output Specifications|Surge current per point/);
    }
  });
  it("a parser layout failure withholds the mixed page over SQL until readable page20 restores QBB scope", async () => {
    await client.query("SAVEPOINT f31_layout_failure");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2", [TENANT, DOCUMENT]);
      const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
      db.failLayoutPage = 19;
      try {
        await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
          filename: fixture.source, buffer: Buffer.from("%PDF source-bound fixture proxy") });
      } finally { db.failLayoutPage = null; }
      const unresolved = await client.query(`SELECT metadata FROM knowledge_entries
        WHERE tenant_id = $1 AND doc_id = $2 AND page_start = 19`, [TENANT, DOCUMENT]);
      expect(unresolved.rows.length).toBeGreaterThan(0);
      expect(unresolved.rows.every((r) => r.metadata.table_unqualified === true && r.metadata.table_scope === "unresolved")).toBe(true);
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        for (const question of ["relay contact ratings 120 V AC", "DC output specifications surge current per point"]) {
          const result = await retrieve(model, question);
          expect(result.chunks.some((c) => c.sourcePage === 19)).toBe(false);
          const failedPage = (result.diagnostics.excludedTables ?? []).filter((e) => e.page === 19);
          expect(failedPage).toEqual(expect.arrayContaining([
            expect.objectContaining({ section: true, unqualified: true }),
          ]));
          const refusal = excludedTablesRefusalText(`2080-LC20-${model}`, failedPage);
          expect(refusal).toMatch(/could not read which models/i);
          expect(refusal).toContain("page 19");
          expect(refusal).not.toMatch(/another model.s column|read the .* column|15 A|interposing|safe to/i);
        }
      }
      const recovered = await retrieve("20QBB", "DC output specifications resistive load");
      expect(recovered.chunks.some((c) => c.sourcePage === 20 && c.content.includes("DC Output Specifications"))).toBe(true);
    } finally {
      db.failLayoutPage = null;
      warning.mockRestore();
      await client.query("ROLLBACK TO SAVEPOINT f31_layout_failure");
      await client.query("RELEASE SAVEPOINT f31_layout_failure");
    }
  });
  it("a foreign tenant cannot contribute matching passages or its earlier document heading", async () => {
    for (const model of ["20QBB", "20QWB", "20AWB"]) {
      const result = await retrieve(model, "foreignscope sentinel analog output relay contact ratings");
      expect(result.text).not.toContain("foreignscope sentinel");
      expect(result.chunks.length).toBeGreaterThan(0);
    }
  });
});

  // Review F1/F2: mutate only the PDF boundary, then execute the production writer and
  // real storage/retrieval. Synthetic pages deliberately share the source fixture's models.
  async function withPages(pages: NonNullable<typeof db.pages>, fn: () => Promise<void>) {
    await client.query("SAVEPOINT review_scope");
    try {
      await client.query("DELETE FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2", [TENANT, DOCUMENT]);
      db.pages = pages;
      const { writePdfChunksForNode } = await import("@/lib/node-knowledge-ingest");
      await writePdfChunksForNode({ tenantId: TENANT, uploadId: DOCUMENT, nodeId: NODE, unsPath: null,
        filename: fixture.source, buffer: Buffer.from("%PDF synthetic review regression") });
      await fn();
    } finally {
      db.pages = null;
      await client.query("ROLLBACK TO SAVEPOINT review_scope");
      await client.query("RELEASE SAVEPOINT review_scope");
    }
  }
  const item = (str: string, x: number, y: number, size = 8) => ({ str, x, y, size, w: str.length * size * 0.4 });
  it.each([10, 14])("F1 a %s-point running header never releases QWB scope in storage/retrieval", async (size) => {
    const pages = structuredClone(fixture.pages);
    const prior = pages.find((p) => p.page === 18)!;
    prior.items = [item("Relay Output Specifications for 2080-LC20-20QWB(R)", 100, 700, 10),
      item("Attribute Value", 100, 680), item("Mechanical life 100000 cycles", 100, 660)];
    prior.text = prior.items.map((i) => i.str).join("\n");
    const next = pages.find((p) => p.page === 19)!;
    next.items = [item("Micro820 Programmable Controllers", 100, 740, size),
      item("zzrunningheader Maximum switching time 10 ms", 100, 680)];
    next.text = next.items.map((i) => i.str).join("\n");
    await withPages(pages, async () => {
      const stored = await client.query("SELECT metadata FROM knowledge_entries WHERE tenant_id=$1 AND page_start=19", [TENANT]);
      expect(stored.rows.length).toBeGreaterThan(0);
      expect(stored.rows.every((r) => r.metadata.table_scope === "unresolved" && r.metadata.table_unqualified)).toBe(true);
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        const result = await retrieve(model, "zzrunningheader switching time");
        expect(result.text).not.toContain("zzrunningheader");
        expect(result.diagnostics.excludedTables).toEqual(expect.arrayContaining([
          expect.objectContaining({ page: 19, unqualified: true, section: true }),
        ]));
      }
      expect((await retrieve("20QBB", "DC output specifications controller current")).text).toContain("Controller current, max total");
    });
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])("F2 genuine two-model columns obey their physical caption (compatible=%s, output inventory=%s)", async (compatible, inventory) => {
    const caption = compatible ? "Output Specifications for 2080-LC20-20QWB(R), 2080-LC20-20AWB(R)"
      : "Output Specifications for 2080-LC20-20QBB(R)";
    const items = [item(caption, 100, 700, 10), item("Attribute", 100, 680),
      item("2080-LC20-20QWB(R)", 280, 680), item("2080-LC20-20AWB(R)", 420, 680),
      item("zzcaptioncurrent Load current max", 100, 660), item("2.0 A", 280, 660), item("1.5 A", 420, 660),
      item("Surge current max", 100, 646), item("4.0 A", 280, 646), item("3.0 A", 420, 646)];
    const cover = "Micro820 20-Point Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const pages = [...(inventory ? structuredClone(fixture.pages) : [{ page: 1, items: [item(cover, 100, 700)], text: cover }]),
      { page: 21, items, text: items.map((i) => i.str).join("\n") }];
    await withPages(pages, async () => {
      const stored = await client.query("SELECT content, metadata FROM knowledge_entries WHERE tenant_id=$1 AND page_start=21", [TENANT]);
      const columns = stored.rows.filter((r) => r.content.includes(": zzcaptioncurrent"));
      expect(columns).toHaveLength(2); // prove pageWithTables actually extracted columns
      expect(columns.every((r) => r.metadata.table_models.length === 1)).toBe(true);
      for (const row of columns) {
        expect(row.metadata.table_unqualified ?? false).toBe(!compatible);
        expect(row.metadata.table_scope ?? null).toBe(compatible ? null : "unresolved");
      }
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        const result = await retrieve(model, "zzcaptioncurrent load current");
        expect(result.chunks.some((c) => c.sourcePage === 21 && c.content.includes(": zzcaptioncurrent"))).toBe(compatible && model !== "20QBB");
      }
    });
  });

  it.each([
    "Output Specifications for 2080-LC20-20QWB only (not 2080-LC20-20QBB)",
    "Output Specifications not for 2080-LC20-20QBB",
    "Output Specifications for 2080-LC20-20QWB",
  ])("F4 caption semantics survive long-window storage and real retrieval: %s", async (caption) => {
    const items = [item(caption, 100, 720, 10), item("Attribute Value", 100, 700),
      item("zznegativecaption Load current max 2 A. ".repeat(100), 100, 680)];
    await withPages([...structuredClone(fixture.pages), { page: 21, items, text: items.map((i) => i.str).join("\n") }], async () => {
      const stored = await client.query("SELECT content, metadata FROM knowledge_entries WHERE tenant_id=$1 AND page_start=21", [TENANT]);
      expect(stored.rows.length).toBeGreaterThan(2);
      expect(stored.rows.some((r) => !r.content.includes("2080-LC20"))).toBe(true);
      const positive = !caption.includes("not");
      expect(stored.rows.every((r) => r.metadata.table_scope === (positive ? "section" : "unresolved"))).toBe(true);
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        expect((await retrieve(model, "zznegativecaption load current")).text.includes("zznegativecaption")).toBe(positive && model === "20QWB");
      }
    });
  });

  it.each(["conflict", "conflict-small-header", "compatible", "new-section", "before-new-section"])("F5 real stored extracted columns retain document boundaries: %s", async (kind) => {
    const compatible = kind === "compatible";
    const prior = [item(compatible ? "Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB" : "Output Specifications for 2080-LC20-20QBB", 100, 720, 10),
      item("Attribute Value", 100, 700), item("Controller current 1 A", 100, 680)];
    const items = [item("Micro820 Programmable Controllers", 100, 760, compatible || kind === "conflict-small-header" ? 9 : 12),
      ...(kind === "new-section" ? [item("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 100, 710, 10)] : []),
      item("Attribute", 100, 680), item("2080-LC20-20QWB(R)", 280, 680), item("2080-LC20-20AWB(R)", 420, 680),
      item("zzcontinuation Load current max", 100, 660), item("2.0 A", 280, 660), item("1.5 A", 420, 660),
      item("Switching time max", 100, 646), item("10 ms", 280, 646), item("8 ms", 420, 646),
      ...(kind === "before-new-section" ? [item("Input Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 100, 600, 10), item("Attribute Value", 100, 580), item("Input current 7 A", 100, 560)] : []),
    ];
    await withPages([...structuredClone(fixture.pages),
      { page: 21, items: prior, text: prior.map((i) => i.str).join("\n") },
      { page: 22, items, text: items.map((i) => i.str).join("\n") }], async () => {
      const stored = await client.query("SELECT content, metadata FROM knowledge_entries WHERE tenant_id=$1 AND page_start=22", [TENANT]);
      const columns = stored.rows.filter((r) => r.content.includes(": zzcontinuation"));
      expect(columns).toHaveLength(2); // genuine pageWithTables extraction followed by production INSERTs
      expect(columns.every((r) => r.metadata.table_models.length === 1)).toBe(true);
      const allowed = compatible || kind === "new-section";
      expect(columns.every((r) => r.metadata.table_scope === "unresolved" && r.metadata.table_unqualified)).toBe(!allowed);
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        const result = await retrieve(model, "zzcontinuation load current");
        expect(result.text.includes("zzcontinuation")).toBe(allowed && model !== "20QBB");
      }
    });
  });

  it.each(["not", "excluding", "affirmative"])("F6 direct negative captions survive long-window and headerless-page real storage: %s", async (qualifier) => {
    const title = `Output Specifications 2080-LC20-20QWB only${qualifier === "affirmative" ? "" : ` (${qualifier} 2080-LC20-20QBB)`}`;
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const body = "zzdirectnegative Point current max 9 A. ".repeat(100);
    const continuation = "zzdirectcontinuation Point surge max 11 A. ".repeat(100);
    const items = [item(title, 100, 740, 10), item("Attribute Value", 100, 720), item(body, 100, 700)];
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items, text: items.map((i) => i.str).join("\n") },
      { page: 3, items: [item(continuation, 100, 700)], text: continuation }], async () => {
      for (const model of ["20QBB", "20QWB", "20AWB"]) {
        const result = await retrieve(model, "zzdirectnegative zzdirectcontinuation current");
        expect(result.text.includes("zzdirect")).toBe(qualifier === "affirmative" && model === "20QWB");
        if (qualifier !== "affirmative") expect(result.diagnostics.excludedTables).toEqual(expect.arrayContaining([
          expect.objectContaining({ page: 2, section: true, unqualified: true }),
          expect.objectContaining({ page: 3, section: true, unqualified: true }),
        ]));
      }
    });
  });

  it.each(["20QBB", "20QWB", "non-table", "non-table-large-body", "non-table-smaller", "non-table-equal", "unnamed-smaller", "unnamed-equal", "unnamed-larger", "uncaptioned-smaller", "uncaptioned-larger", "uncaptioned-model", "non-table-tall-label"])("F7 real extracted columns cannot swallow adjacent %s electrical values", async (nextModel) => {
    const items = [item("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 100, 740, nextModel.endsWith("smaller") || nextModel.endsWith("equal") ? 12 : 10),
      item("Attribute", 100, 720), item("2080-LC20-20QWB(R)", 280, 720), item("2080-LC20-20AWB(R)", 420, 720),
      item("zzoriginalvalue Load current max", 100, 706), item("2.0 A", 280, 706), item("1.5 A", 420, 706),
      item("Switching time max", 100, 692), item("10 ms", 280, 692), item("8 ms", 420, 692),
      item((nextModel.startsWith("unnamed") || (nextModel.startsWith("uncaptioned") && nextModel !== "uncaptioned-model")) ? "DC Output Data" : (nextModel.startsWith("non-table") || nextModel === "uncaptioned-model") ? "DC Output Data for 2080-LC20-20QBB" : `Output Specifications for 2080-LC20-${nextModel}`, 100, 676, nextModel.endsWith("smaller") ? 10 : nextModel.startsWith("non-table") || (nextModel.startsWith("unnamed") || nextModel.startsWith("uncaptioned")) ? 12 : 10),
      item("Attribute", 100, 662), item("Value", 280, 662),
      item("zzadjacentvalue Point current max", 100, 648, nextModel === "non-table-large-body" ? 12 : 8), item("9 A", 280, 648, nextModel === "non-table-large-body" ? 12 : 8),
      item("Point surge max", 100, 634), item("11 A", 280, 634)];
    if (nextModel.startsWith("uncaptioned")) items.shift();
    if (nextModel === "non-table-tall-label") {
      for (const cell of items.filter((i) => i.y === 720)) cell.size = 12;
      items.find((i) => i.y === 740)!.size = 14;
      items.find((i) => i.y === 706)!.size = 14;
      items.find((i) => i.y === 706)!.str = "zzoriginalvalue Current";
      items.find((i) => i.y === 676)!.size = 10;
      for (const cell of items) cell.w = cell.str.length * cell.size * 0.4;
    }
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items, text: items.map((i) => i.str).join("\n") },
      { page: 3, items: [item("zzboundarycontinuation Point current max 9 A", 100, 720)], text: "zzboundarycontinuation Point current max 9 A" }], async () => {
      for (const model of ["20QWB", "20AWB", "20QBB"]) {
        const result = await retrieve(model, "zzadjacentvalue Point current max");
        expect(result.text.includes("zzadjacentvalue")).toBe(model === nextModel);
        expect((await retrieve(model, "zzboundarycontinuation Point current max")).text.includes("zzboundarycontinuation")).toBe(model === nextModel);
      }
      for (const [model, value] of [["20QWB", "2.0 A"], ["20AWB", "1.5 A"]]) {
        const result = await retrieve(model, "zzoriginalvalue Load current max");
        expect(result.text).toContain(value);
        expect(result.chunks.filter((c) => c.content.includes(": zzoriginalvalue")).every((c) => !c.content.includes("zzadjacentvalue"))).toBe(true);
      }
    });
  });

  it.each(["named", "unnamed", "next-page", "named-no-header", "unnamed-no-header", "next-page-no-header", "named-no-header-tall-header", "named-no-header-tall-label", "named-no-header-close", "named-no-header-unicode", "named-no-header-long", "named-no-header-body-note", "named-no-header-heading-note", "named-no-header-negative", "named-no-header-indented", "named-no-header-raw-values", "named-no-header-split-title", "next-page-no-header-indented", "next-page-no-header-split-title", "named-no-header-indented-bold-label", "named-no-header-larger-body", "named-no-header-same-body-font", "named-no-header-same-body-font-negative", "named-no-header-wide-gap", "named-no-header-page-end"])("F10 real single-model upload rejects smaller %s sibling headings and headerless continuation", async (kind) => {
    const items = [item("Output Specifications for 2080-LC20-20QWB", 100, 740, 12),
      item("Attribute Value", 100, 720), item("zzf10original Load current max 2 A", 100, 706),
      item(kind.startsWith("named") ? "DC Output Data for 2080-LC20-20QBB" : "DC Output Data", 100, 676, 10),
      item("Attribute Value", 100, 662), item("zzf10adjacent Point current max 9 A", 100, 648),
      item("zzf10surge Point surge max 11 A", 100, 634)];
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    if (kind.endsWith("tall-header") || kind.endsWith("tall-label")) { items[0].size = 16; items[1].size = 12; }
    if (kind.endsWith("tall-label")) items.splice(2, 1, item("zzf10original Load current max",100,706,14),item("2 A",320,706));
    if (kind.includes("no-header")) items.splice(items.findIndex((i) => i.y === 662), 1);
    if (kind.endsWith("close")) for (const i of items) {
      if (i.y === 676) i.y = 692; else if (i.y === 648) i.y = 678; else if (i.y === 634) i.y = 664;
    }
    if (kind.endsWith("body-note")) {
      items[0].size=16;items[1].size=12;
      items.splice(2,1,item("zzf10original Load current max",100,706,14),item("2 A",320,706),item("(1)",330,706,4));
    }
    if (kind.endsWith("heading-note")) {
      const title=items.find((i)=>i.str.startsWith("DC Output Data"))!;
      items.push(item("(1)",title.x+title.w+2,title.y,4));
    }
    if (kind.endsWith("negative")) items.find((i)=>i.str.startsWith("DC Output Data"))!.str="DC Output Data (not for 2080-LC20-20QWB)";
    if (kind.endsWith("unicode")) items.find((i) => i.str.startsWith("DC Output Data"))!.str = items.find((i) => i.str.startsWith("DC Output Data"))!.str.replaceAll("-", "\u2011");
    if (kind.includes("indented")) for (const i of items) { if (i.y === 648 || i.y === 634) i.x = 180; }
    if (kind.endsWith("raw-values")) for (const y of [648, 634]) {
      const at = items.findIndex((i) => i.y === y);
      items.splice(at, 1, item(y === 648 ? "9 A" : "11 A", 350, y), item(y === 648 ? "zzf10adjacent" : "zzf10surge", 430, y));
    }
    if (kind.endsWith("split-title")) {
      const at = items.findIndex((i) => i.str.startsWith("DC Output Data"));
      items.splice(at, 1, item("DC Output Data for", 100, 676, 10), item("2080-LC20-20QBB", 350, 676, 10));
    }
    if (kind.endsWith("bold-label")) {
      const at = items.findIndex((i) => i.y === 648);
      items.splice(at, 1, item("zzf10adjacent Point current max", 180, 648, 11), item("9 A", 350, 648));
    }
    if (kind.endsWith("larger-body")) for (const i of items) { if (i.y === 648 || i.y === 634) i.size = 11; }
    if (kind.includes("same-body-font")) items.find((i) => i.str.startsWith("DC Output Data"))!.size = 8;
    if (kind.endsWith("wide-gap")) for (const i of items) { if (i.y === 648 || i.y === 634) i.y -= 48; }
    if (kind.endsWith("long")) {
      items.find((i) => i.y === 634)!.y = 320;
      for (let n=0;n<20;n++) items.push(item("Additional electrical operating conditions and parameter context without a new model assertion.",100,620-n*14));
    }
    const pages = [{ page: 1, items: [item(cover, 100, 760, 12)], text: cover }];
    for (const body of kind.startsWith("next-page") ? [items.slice(0, 3), items.slice(3)] : kind.endsWith("page-end") ? [items.slice(0, 4), items.slice(4)] : [items]) {
      pages.push({ page: pages.length + 1, items: body, text: body.map((i) => i.str).join("\n") });
    }
    pages.push({ page: pages.length + 1, items: [item("zzf10continued Point current max 9 A", 100, 720)], text: "zzf10continued Point current max 9 A" });
    await withPages(pages, async () => {
      for (const model of ["20QWB", "20AWB", "20QBB"]) {
        for (const token of ["zzf10adjacent", "zzf10surge", "zzf10continued"]) {
          expect((await retrieve(model, kind.endsWith("raw-values") ? token : `${token} Point current max`)).text).not.toContain(token);
        }
      }
      expect((await retrieve("20QWB", "zzf10original Load current max")).text).toContain("2 A");
      expect((await retrieve("20QBB", "zzf10original Load current max")).text).not.toContain("zzf10original");
      const stored = await client.query("SELECT content,metadata FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2 AND is_private = true", [TENANT,DOCUMENT]);
      for (const token of ["zzf10adjacent", "zzf10surge", "zzf10continued"]) {
        const rows = stored.rows.filter((r) => r.content.includes(token));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.metadata.table_scope === "unresolved")).toBe(true);
      }
      expect(stored.rows.some((r) => r.content.includes("zzf10original") && r.metadata.table_scope === "section")).toBe(true);
    });
  });

  it.each(columnBoundaryMatrix)("F10 actual writer/SQL rejects extracted-column boundary $id", async (c) => {
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const pages = [{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      ...columnBoundaryMatrixPages(c).map((items, i) => ({ page: i + 2, items, text: items.map((r) => r.str).join("\n") }))];
    await withPages(pages, async () => {
      for (const [model, value] of [["20QWB", "2 A"], ["20AWB", "1 A"]]) {
        expect((await retrieve(model, "zzmatrixoriginal Load current")).text).toContain(value);
      }
      for (const model of ["20QWB", "20QBB", "20AWB"]) for (const token of ["zzmatrixfirst", "zzmatrixlast", "zzmatrixcontinued"]) {
        expect((await retrieve(model, token)).text).not.toContain(token);
      }
    });
  });

  it.each(columnSemanticMatrix)("F12 actual writer/SQL rejects semantic extracted-column boundary $id", async (c) => {
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const pages = [{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      ...columnSemanticMatrixPages(c).map((items, i) => ({ page: i + 2, items, text: items.map((r) => r.str).join("\n") }))];
    await withPages(pages, async () => {
      for (const [model, value] of [["20QWB", "2 A"], ["20AWB", "1 A"]]) {
        expect((await retrieve(model, "zzcolumnoriginal Load current")).text).toContain(value);
      }
      const stored = await client.query("SELECT content,metadata FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2 AND is_private = true", [TENANT,DOCUMENT]);
      for (const token of ["zzcolumnfirst", "zzcolumnlast", "zzcolumncontinued"]) {
        const rows = stored.rows.filter((r) => r.content.includes(token));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.metadata.table_unqualified || r.metadata.table_scope === "unresolved")).toBe(true);
        for (const model of ["20QWB", "20AWB", "20QBB"]) expect((await retrieve(model, token)).text).not.toContain(token);
      }
    });
  });

  it.each(columnMeasuredMatrix)("F12 actual writer/SQL preserves measured extracted-column row $id", async (c) => {
    const items = columnMeasuredMatrixPage(c);
    await withPages([{ page: 1, items, rules: columnMeasuredMatrixRules(c), text: items.map((r) => r.str).join("\n") }], async () => {
      for (const [model, original, later] of [["20QWB", "2 A", "3 A"], ["20AWB", "1 A", "4 A"]]) {
        expect((await retrieve(model, "zzcolumnoriginal Load current")).text).toContain(original);
        const measured = (await retrieve(model, "zzcolumnmeasured")).text;
        if (columnMeasuredLaterQualified(c)) expect(measured).toContain(later);
        else expect(measured).not.toContain(later);
      }
    });
  });

  it.each(measuredMatrix)("F10 actual writer/SQL preserves measured data $id", async (c) => {
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const items = measuredMatrixPage(c);
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items, text: items.map((r) => r.str).join("\n") }], async () => {
      expect((await retrieve("20QWB", "zzmeasureoriginal Load current")).text).toContain("2 A");
      const later = (await retrieve("20QWB", "zzmeasurelast Switching time")).text;
      if (c.font === 14) expect(later).not.toContain("10 ms"); // retain pre-existing uncertainty
      else expect(later).toContain("10 ms");
      expect((await retrieve("20QBB", "zzmeasureoriginal Load current")).text).not.toContain("zzmeasureoriginal");
    });
  });

  it.each(boundaryMatrix)("F10 actual writer/SQL rejects geometry-independent boundary $id", async (c) => {
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const pages = [{ page: 1, items: [item(cover, 100, 760, 12)], text: cover }];
    for (const items of boundaryMatrixPages(c)) pages.push({ page: pages.length + 1, items, text: items.map((r) => r.str).join("\n") });
    await withPages(pages, async () => {
      for (const model of ["20QWB", "20QBB", "20AWB"]) {
        for (const token of ["zzmatrixfirst", "zzmatrixlast", "zzmatrixcontinued"]) {
          expect((await retrieve(model, token)).text).not.toContain(token);
        }
      }
      expect((await retrieve("20QWB", "zzmatrixoriginal Load current max")).text).toContain("2 A");
      expect((await retrieve("20QBB", "zzmatrixoriginal Load current max")).text).not.toContain("zzmatrixoriginal");
      const stored = await client.query("SELECT content,metadata FROM knowledge_entries WHERE tenant_id = $1 AND doc_id = $2 AND is_private = true", [TENANT,DOCUMENT]);
      for (const token of ["zzmatrixfirst", "zzmatrixlast", "zzmatrixcontinued"]) {
        const rows = stored.rows.filter((r) => r.content.includes(token));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.metadata.table_scope === "unresolved")).toBe(true);
      }
    });
  });

  it.each([false, true])("F13 actual SQL bounds fresh column ownership without releasing explicit section uncertainty=%s", async (section) => {
    const first = [...(section ? [item("Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB", 100, 740, 12)] : []),
      item("Attribute", 100, 720), item("2080-LC20-20QWB", 280, 720), item("2080-LC20-20AWB", 420, 720),
      item("Original current", 100, 706), item("2 A", 280, 706), item("1 A", 420, 706),
      item("Original interval", 100, 692), item("10 ms", 280, 692), item("8 ms", 420, 692),
      item("Derating", 100, 680), item("zzcontextold current", 100, 668), item("9 A", 280, 668), item("11 A", 420, 668)];
    const next = [item("Attribute", 100, 720), item("2080-LC20-20AWB", 280, 720), item("2080-LC20-20QWB", 420, 720),
      item("zzcontextfresh current", 100, 706), item("3 A", 280, 706), item("4 A", 420, 706),
      item("Original interval", 100, 692), item("12 ms", 280, 692), item("7 ms", 420, 692)];
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const ordinary = [item("Type", 416.52, 720), item("Hex Addr", 457.02, 720), item("Dec Addr", 506.52, 720),
      ...["P01.12", "P01.13", "P01.14"].flatMap((key, index) => [item(key, 74, 706 - index * 14),
        item("zzordinaryparameter Acceleration time", 117, 706 - index * 14), item("R/W", 423, 706 - index * 14),
        item(["010C", "010D", "010E"][index], 463, 706 - index * 14), item(String(40269 + index), 513, 706 - index * 14)])];
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items: first, text: first.map((row) => row.str).join("\n") },
      { page: 3, items: next, text: next.map((row) => row.str).join("\n") },
      { page: 4, items: ordinary, text: ordinary.map((row) => row.str).join("\n") }], async () => {
      for (const model of ["20QWB", "20AWB", "20QBB"]) expect((await retrieve(model, "zzcontextold current")).text).not.toContain("zzcontextold");
      for (const [model, value] of [["20AWB", "3 A"], ["20QWB", "4 A"]]) {
        const result = await retrieve(model, "zzcontextfresh current");
        expect(result.text.includes(value)).toBe(!section);
      }
      expect((await retrieve("20QBB", "zzcontextfresh current")).text).not.toContain("zzcontextfresh");
      expect((await retrieve("20QWB", "zzordinaryparameter Acceleration time")).text.includes("zzordinaryparameter")).toBe(!section);
    });
  });

  it.each(["catalog", "parameter", "parameter-explicit"])("F7 real SQL preserves interrupted %s column ownership without creating an equipment domain", async (kind) => {
    const items = [item("Attribute", 100, 720), item(kind === "catalog" ? "2080-LC20-20QWB" : "P01.20", 280, 720), item(kind === "catalog" ? "2080-LC20-20AWB" : "P01.21", 420, 720),
      item("zzoriginalsingle Load current max", 100, 706), item("2 A", 280, 706), item("1 A", 420, 706),
      item("DC Output Data", 100, 690, 10), item("Attribute", 100, 676), item("Value", 280, 676), item("zzuncaptioned Point current max", 100, 662), item("9 A", 280, 662)];
    const generic = [item(kind === "parameter-explicit" ? "DC Output Specifications for 2080-LC20-20QBB" : "General Specifications", 100, 720, 12), item("Attribute Value", 100, 700), item("zzuncaptioned Point surge max 11 A", 100, 686)];
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items, text: [...items].reverse().map((i) => i.str).join("\n") },
      { page: 3, items: generic, text: generic.map((i) => i.str).join("\n") },
      { page: 4, text: "zzuncaptioned Point current max 12 A", items: [item("zzuncaptioned Point current max 12 A", 100, 720)] }], async () => {
      const result = await retrieve("20QWB", "zzuncaptioned Point current max");
      if (kind === "catalog") expect(result.text).not.toContain("zzuncaptioned");
      else if (kind === "parameter") for (const value of ["9 A", "11 A", "12 A"]) expect(result.text).toContain(value);
      else {
        expect(result.text).toContain("9 A");
        expect(result.text).not.toContain("11 A");
        expect(result.text).not.toContain("12 A");
        const own = await retrieve("20QBB", "zzuncaptioned Point current max");
        expect(own.text).toContain("11 A");
        expect(own.text).toContain("12 A");
      }
    });
  });

  it("duplicate catalog columns retain both values in storage and admit neither as a qualified own-model value", async () => {
    const items = [item("Attribute", 100, 720), item("2080-LC20-20QWB", 280, 720), item("2080-LC20-20QWB", 420, 720),
      item("zzduplicate Connection", 100, 706), item("internally", 280, 706), item("externally", 420, 706),
      item("Inputs per Module", 100, 692), item("4", 280, 692), item("8", 420, 692)];
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      { page: 2, items, text: items.map((i) => i.str).join("\n") }], async () => {
      const rows = await client.query("SELECT content,metadata FROM knowledge_entries WHERE tenant_id=$1 AND doc_id=$2 AND page_start=2 AND is_private = true", [TENANT,DOCUMENT]);
      const text = rows.rows.map((r) => r.content).join("\n");
      expect(text).toContain("internally");
      expect(text).toContain("externally");
      expect(rows.rows.filter((r) => r.content.includes("zzduplicate")).every((r) => r.metadata.table_unqualified === true)).toBe(true);
      expect((await retrieve("20QWB", "zzduplicate Connection")).text).not.toContain("zzduplicate");
    });
  });

  it.each(["independent", "independent-footnote", "inherited-conflict", "inherited-compatible"])("F8 real storage keeps readable headingless columns with %s scope", async (kind) => {
    const cover = "Micro820 Programmable Controllers\n2080-LC20-20QBB, 2080-LC20-20QWB, 2080-LC20-20AWB";
    const caption = kind === "inherited-compatible" ? "Output Specifications for 2080-LC20-20QWB, 2080-LC20-20AWB" : "Output Specifications for 2080-LC20-20QBB";
    const prior = [item(caption, 100, 740, 10), item("Attribute Value", 100, 720), item("Controller current max 1 A", 100, 700)];
    const items = [item("Attribute", 100, 720), item("2080-LC20-20QWB(R)", 280, 720), item("2080-LC20-20AWB(R)", 420, 720),
      item("zzheadingless Load current max", 100, 700), item("2 A", 280, 700), item("1 A", 420, 700),
      item("Switching time max", 100, 686), item("10 ms", 280, 686), item("8 ms", 420, 686)];
    if (kind === "independent-footnote") {
      items.push(item("1", 100, 660, 4.9));
      for (const row of items) if (row.str.includes("Load current max") || row.str === "Switching time max") row.size = 10;
    }
    await withPages([{ page: 1, items: [item(cover, 100, 760, 12)], text: cover },
      ...(kind.startsWith("independent") ? [] : [{ page: 2, items: prior, text: prior.map((i) => i.str).join("\n") }]),
      { page: kind.startsWith("independent") ? 2 : 3, items, text: items.map((i) => i.str).join("\n") }], async () => {
      for (const [model, value] of [["20QWB", "2 A"], ["20AWB", "1 A"]]) {
        const result = await retrieve(model, "zzheadingless Load current max");
        expect(result.text.includes("zzheadingless")).toBe(kind !== "inherited-conflict");
        if (kind !== "inherited-conflict") {
          expect(result.text).toContain(value);
          expect(result.text).not.toContain(model === "20QWB" ? "20AWB(R):" : "20QWB(R):");
        }
      }
      expect((await retrieve("20QBB", "zzheadingless current")).text).not.toContain("zzheadingless");
    });
  });

  it("a shared header marker cannot admit sibling-only prose over actual SQL", async () => {
    await client.query("SAVEPOINT f31_shared_prose");
    try {
      await client.query(`INSERT INTO knowledge_entries
        (tenant_id, content, source_url, doc_id, ingest_route, page_start, metadata, is_private)
        VALUES ($1, '2080-LC20-20QWB(R) only: zzscopevariantonly relay evidence.',
          'node-doc/f31-prose/manual.pdf', $2, 'v2', 30, $3::jsonb, true)`,
      [TENANT, DOCUMENT, JSON.stringify({ node_id: NODE, filename: fixture.source,
        table_scope: "shared", table_header: "Attribute Common inputs Isolated inputs 2080-LC20-20QWB(R)" })]);
      const own = await retrieve("20QWB", "zzscopevariantonly");
      expect(own.text).toContain("zzscopevariantonly");
      const sibling = await retrieve("20QBB", "zzscopevariantonly");
      expect(sibling.text).not.toContain("zzscopevariantonly");
      expect(sibling.diagnostics.excludedTables).toEqual(expect.arrayContaining([
        expect.objectContaining({ page: 30, models: ["2080LC2020QWB"] }),
      ]));
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT f31_shared_prose");
      await client.query("RELEASE SAVEPOINT f31_shared_prose");
    }
  });

});


// Public fictional identifier controls run inside the existing beta-gate SQL suite.
// #5484, narrowed (PR #5500): the six hyphen equivalents of the shared detection fold, written
// directly inside an identifier, compare as "-". A spaced dash and the en dash are NOT in scope and
// keep the reading they have on main; the cases marked OPEN state that remaining defect.
describe("#5484 catalog identifier folding and counted inventory — real SQL", () => {
const TENANT = "84000000-0000-4000-8000-000000000001", FOREIGN = "84000000-0000-4000-8000-000000000002";
const doc = (n: number) => `84000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
const OWN_DOC = doc(1), KNOWN_DOC = doc(2), SIBLING_DOC = doc(3), OTHER_NODE_DOC = doc(4), OLD_DOC = doc(5);
const TABLE_OWN = doc(6), TABLE_SIBLING = doc(7), TABLE_UNQUALIFIED = doc(8);
const COUNTED_OWN_DOC = doc(9);
const OWN = "ZX731-04A", SIBLING = "ZX731-09C", KNOWN = "GS11N-20P2", KNOWN_SIBLING = "GS11N-20P5";
const NODE = "catalog-fold-current", BODY = "UNIT_FICTIONAL_LEGEND: indicator legend and reference marker description. No physical setting is asserted.";
const variants = ["-", "\u2010", "\u2011", "\u2012", "\u2212", "\uFE63", "\uFF0D"];
const unsupported = [" - ", " \u2011 ", "\u2013", " \u2013 "];
const BARE_DOC = doc(10), OTHER_FAMILY_DOC = doc(11);
// Round 4 (F5): one ZX735 manual per hyphen, holding its own rating passage and an untagged
// passage that names the sibling ZX731 with that hyphen.
const supportedHyphens = variants.filter((separator) => separator !== "-");
const PASSAGE_OWN = "ZX735 UNIT_FICTIONAL_RATING: rated current reference value 12 A. No physical setting is asserted.";
const passageSibling = (separator: string) => `ZX731${separator}04A UNIT_FICTIONAL_RATING: rated current reference value 10 A. No physical setting is asserted.`;
const passageDoc = (separator: string) => doc(60 + variants.indexOf(separator));
const ASCII_PASSAGE_DOC = doc(59);
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
  await insert(TENANT, COUNTED_OWN_DOC, "NC-24 Indicator Module\nUser Manual", "NC-24.pdf");
  await insert(TENANT, BARE_DOC, "ZX731 Logic Controller\nUser Manual", "ZX731.pdf");
  await insert(TENANT, OTHER_FAMILY_DOC, "ZX735 Logic Controller\nUser Manual", "ZX735.pdf");
  for (const [index, separator] of variants.entries()) {
    await insert(TENANT, doc(20 + index), `${spell(OWN, separator)} Logic Controller\nUser Manual`, `${OWN}.pdf`);
    await insert(TENANT, doc(30 + index), `${OWN} Logic Controller\nUser Manual`, `${spell(OWN, separator)}.pdf`);
    await insert(TENANT, doc(40 + index), `${OWN} Logic Controller\nUser Manual`, `${spell(SIBLING, separator)}.pdf`);
  }
});
beforeAll(async () => {
  const passages = async (document: string, sibling: string) => {
    for (const [page, content] of [[1, "ZX735 Logic Controller\nUser Manual"], [8, PASSAGE_OWN], [9, sibling]] as const) {
      await client.query(`INSERT INTO knowledge_entries
        (tenant_id, content, source_url, source_page, page_start, metadata, doc_id, ingest_route, verified, is_private)
        VALUES ($1,$2,$3,$4,$4,$5::jsonb,$6,'v2',false,true)`,
      [TENANT, content, `https://manual.unit.invalid/${document}`, page,
        JSON.stringify({ node_id: NODE, filename: "ZX735.pdf", chunk_index: page + 10 }), document]);
    }
  };
  for (const separator of supportedHyphens) await passages(passageDoc(separator), passageSibling(separator));
  await passages(ASCII_PASSAGE_DOC, passageSibling("-"));
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

describe("round 4 (F5): an untagged sibling passage inside the record's own manual — real SQL", () => {
  const ask = "What is the rated current reference value?";
  it.each(supportedHyphens)("the sibling's passage written with %j never returns; the record's own does", async (separator) => {
    const hits = await retrieve(ask, [passageDoc(separator)], record("ZX735"));
    expect(hits.some((hit) => hit.content === PASSAGE_OWN)).toBe(true);
    expect(hits.filter((hit) => hit.content.includes("10 A"))).toEqual([]);
    expect(hits.every((hit) => hit.docId === passageDoc(separator))).toBe(true);
  });
  it("control: without a confirmed record nothing is left out, so the passage is retrievable at all", async () => {
    const hits = await retrieve(ask, [passageDoc(supportedHyphens[0])]);
    expect(hits.some((hit) => hit.content.includes("10 A"))).toBe(true);
  });
  it("OPEN, as on main: the ASCII spelling of the same passage is one long number and is not left out", async () => {
    const hits = await retrieve(ask, [ASCII_PASSAGE_DOC], record("ZX735"));
    expect(hits.some((hit) => hit.content === PASSAGE_OWN)).toBe(true);
    expect(hits.some((hit) => hit.content.includes("10 A"))).toBe(true);
  });
});

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

describe.each(variants.slice(1))("folding %j adds a reading and never replaces the written one — real SQL", (separator) => {
  // Main reads the Unicode spelling as the bare family number and refuses the ZX735 manual. The
  // folded reading is added beside it, so that refusal stands.
  it("a manual refused for the written reading stays refused", async () => {
    expect(await retrieve(question(spell(OWN, separator)), [OTHER_FAMILY_DOC])).toEqual([]);
    expect(await retrieve(question(`${SIBLING}${separator}24V`))).toEqual([]);
  });
});

// The three review findings on PR #5500 (ledgers 6892548431, 6892789648, 6893044534). Each came from
// a spaced-dash rule this PR had added and has removed; each case now reads as it does on main.
describe("review regressions: a spaced dash is never a separator — real SQL", () => {
  const tailed = (identifier: string, tail: string) => `For ${identifier}${tail}, which fictional indicator legend applies?`;
  it.each([" - 24V", " \u2013 24V", " \u2011 24V", " - 2nd alarm", " - 3PH", " - 5MIN", " - 24AX"])("round 2: refuses the sibling with tail %j without a confirmed record", async (tail) => {
    expect(await retrieve(tailed(SIBLING, tail))).toEqual([]);
  });
  it.each([" - 24V", " - 2nd alarm", " - 3PH"])("round 2 control: the own number with tail %j still retrieves its manual", async (tail) => {
    hasLegend(await retrieve(tailed(OWN, tail)), OWN_DOC);
  });
  it.each([" - 24VOLT", " - 24VOLTS", " - 3PHASE", " - 24V"])("round 3: a bare model with tail %j is refused the other model's manual", async (tail) => {
    expect(await retrieve(tailed("ZX731", tail), [OTHER_FAMILY_DOC])).toEqual([]);
    hasLegend(await retrieve(tailed("ZX731", tail), [BARE_DOC]), BARE_DOC);
  });
});

// OPEN in #5484, not repaired here: these state what main does today.
describe.each(unsupported)("OPEN #5484: separator %j is still split — real SQL", (separator) => {
  it("a sibling spelled this way still reaches the own manual", async () => {
    hasLegend(await retrieve(question(spell(SIBLING, separator))), OWN_DOC);
  });
  // Main already reads a GS catalog written with a spaced ASCII hyphen; every other spelling here
  // loses the catalog, and the sibling's table is then served to the confirmed record.
  it("a confirmed record spelled this way admits the sibling table, except the spaced ASCII GS form", async () => {
    const hits = await retrieve("Which fictional indicator legend applies?", [TABLE_SIBLING], knownRecord(spell(KNOWN, separator)));
    expect(hits.length > 0).toBe(separator !== " - ");
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


describe.each(variants)("counted identifier admission over actual SQL: separator %j", (separator) => {
  it("retains the exact own NC24 legend after an inventory count", async () => {
    const inventory = `For 2 NC${separator}24 indicators, which fictional indicator legend applies?`;
    hasLegend(await retrieve(inventory, [COUNTED_OWN_DOC]), COUNTED_OWN_DOC);
  });
  it("does not let counted NC28 borrow the NC24 legend", async () => {
    const inventory = `For 2 NC${separator}28 indicators, which fictional indicator legend applies?`;
    expect(await retrieve(inventory, [COUNTED_OWN_DOC])).toEqual([]);
  });
});

});
