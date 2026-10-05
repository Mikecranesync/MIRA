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
