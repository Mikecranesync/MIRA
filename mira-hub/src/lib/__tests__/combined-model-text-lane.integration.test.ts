/**
 * Combined model-correctness release (#5671 + #5720), the text lane on the REAL retrieval SQL:
 * the actual BM25 + cover-read statements of retrieveNodeChunks run against a disposable
 * Postgres (TEMP knowledge_entries; no persistent row or schema). Covers are SYNTHETIC
 * reconstructions of what #5720 and the #5671 review state; the real Fatek / Comfort first-block
 * text is not in the packet (known gap in IMPLEMENTER-REPORT.md).
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/lib/__tests__/combined-model-text-lane
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveNodeChunks } from "../manual-rag";

vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
});

const TENANT = "39700000-0000-4000-8000-0000000006a0";
type Manual = { key: string; doc: string; file: string; cover: string; body: string };
const manual = (n: number, key: string, file: string, cover: string, body: string): Manual => ({ key, doc: `39700000-0000-4000-8000-0000000006b${n}`, file, cover, body });
const MANUALS = {
  fatek: manual(1, "fatek", "fbs-comms.pdf", "FBs-PLC User Manual II\nChapter 12 Communication Ports and Protocols\nPORT0 RS-232, PORT1 RS-485, PORT2 RS-485",
    "PORT2 RS-485 default baud rate 9600 bps, 8 data bits, even parity. Wire the HMI to PORT2 with a terminating resistor."),
  comfort: manual(2, "comfort", "comfort-panels-oi.pdf", "SIMATIC HMI\nHMI devices\nComfort Panels\nOperating Instructions",
    "KTP400 Comfort supply voltage 24 V DC, range 19.2 V to 28.8 V. Mounting clearance for ventilation behind the panel is 10 mm."),
  comfortListed: manual(3, "comfort-listed", "comfort-listed-oi.pdf", "SIMATIC HMI KTP700 Comfort, KTP900 Comfort, KTP1200 Comfort, TP700 Comfort\nOperating Instructions",
    "KTP700 Comfort supply voltage 24 V DC. Ventilation clearance behind the panel is 10 mm."),
  rx410: manual(4, "rx410", "rx410-hardware-guide.pdf", "Northfield RX410 Logic Controller\nHardware User Guide",
    "RX410 supply voltage 24 V DC. Fault F0004 means overcurrent on the RX410. Ventilation clearance is 20 mm."),
  br200: manual(5, "br200", "1234-BR100_is_a_copy.pdf", "1234-BR200 Drive User Manual",
    "1234-BR200 supply voltage 24 V DC rated current 4 A."),
  br100: manual(6, "br100", "1234-BR100_is_a_copy_1234-BR200.pdf", "1234-BR100 Drive User Manual",
    "1234-BR100 supply voltage 24 V DC rated current 2 A."),
  micro: manual(7, "micro", "2080-IN009B_EN_P.pdf", "Installation Instructions\nMicro820 20-Point Programmable Controllers\nCatalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR",
    "Micro820 2080-LC20-20QWB supply voltage 24 V DC relay contact ratings."),
} as const;

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
  for (const m of Object.values(MANUALS)) {
    for (const [page, content] of [[1, m.cover], [7, m.body]] as const) {
      await client.query(
        `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url, page_start, doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', $3, $4, $5, 'v2', jsonb_build_object('node_id', $6::text, 'filename', $7::text, 'chunk_index', $4::int), true, true)`,
        [TENANT, content, `https://test.invalid/${m.file}`, page, m.doc, `node-${m.key}`, m.file],
      );
    }
  }
});

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  if (pool) await pool.end();
});

type Diag = {
  namedModelMismatch?: { requested: string[]; declared: string[]; source?: string };
  unlistedModelRefusal?: { kind: string; asked: string[]; declared: string[]; source: string };
} & Record<string, unknown>;

async function ask(key: keyof typeof MANUALS, message: string, opts: { earlier?: string[]; identity?: { manufacturer: string; model: string } } = {}) {
  const m = MANUALS[key];
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, TENANT, message, {
    nodeId: `node-${m.key}`,
    unsPath: null,
    docIds: [m.doc],
    validatedDocScope: true,
    rawQuery: message,
    ...(opts.identity ? { identity: opts.identity, identityStatus: "user_confirmed" as const } : {}),
    ...(opts.earlier ? { subjectQueries: opts.earlier } : {}),
    diagnostics,
  } as Parameters<typeof retrieveNodeChunks>[3]);
  return { hits, diagnostics };
}

describe("fault, alarm, parameter, port and register tokens never pick or refuse a manual", () => {
  it("Fatek: the whole sentence with PORT2 and RS485 answers from the comms chapter, then so does the next", async () => {
    const first = await ask("fatek", "fatek fbs port2 rs485 not talkin to the hmi. wat baud is it by default");
    expect(first.hits.length).toBeGreaterThan(0);
    expect(first.diagnostics.unlistedModelRefusal).toBeUndefined();
    const later = await ask("fatek", "wat about the terminating resistor on port2", { earlier: ["fatek fbs port2 rs485 not talkin to the hmi. wat baud is it by default"] });
    expect(later.hits.length).toBeGreaterThan(0);
  });
  it("a fault code beside a typed model: the model decides, the code never refuses", async () => {
    expect((await ask("rx410", "what does fault F0004 mean on the RX410")).hits.length).toBeGreaterThan(0);
    expect((await ask("rx410", "what does fault F0004 mean")).hits.length).toBeGreaterThan(0);
  });
});

describe("Comfort Panels family (#5720)", () => {
  it("KTP 400 Comfort (odd spacing) and KTP400 Comfort answer from a cover that names the family", async () => {
    for (const q of ["KTP 400   Comfort  - what volts min max", "KTP400 Comfort what supply voltage"]) {
      const r = await ask("comfort", q);
      expect(r.hits.length, q).toBeGreaterThan(0);
      expect(r.diagnostics.namedModelMismatch, q).toBeUndefined();
    }
  });
  it("contrast: a cover that LISTS panels answers a listed one and refuses KTP400 and TP1500", async () => {
    expect((await ask("comfortListed", "KTP 700 Comfort supply voltage")).hits.length).toBeGreaterThan(0);
    for (const q of ["KTP400 Comfort supply voltage", "TP1500 Comfort supply voltage"]) {
      const r = await ask("comfortListed", q);
      expect(r.hits, q).toHaveLength(0);
    }
  });
  it("control: a KTP700 BASIC question is not answered from the Comfort family cover", async () => {
    expect((await ask("comfort", "KTP700 Basic supply voltage")).hits).toHaveLength(0);
  });
  it("an unrelated question after a Comfort question stands alone and answers", async () => {
    const r = await ask("comfort", "una mas — cuanto espacio necesito detras del panel pa la ventilacion?", { earlier: ["KTP 400   Comfort  - what volts min max"] });
    expect(r.hits.length).toBeGreaterThan(0);
  });
});

describe("a refusal belongs to the question that named the product", () => {
  const EARLIER = ["RX420 will not start"];
  it("a pointer, a bare code and the same topic again keep the refused model's subject (refused as the conversation's)", async () => {
    for (const q of ["and its current draw?", "what does fault F0004 mean", "what is the supply voltage"]) {
      const r = await ask("rx410", q, { earlier: q.includes("supply") ? ["what is the supply voltage of the RX420"] : EARLIER });
      expect(r.hits, q).toHaveLength(0);
      expect(r.diagnostics.unlistedModelRefusal?.source, q).toBe("conversation");
    }
  });
  it("an unrelated question of its own answers; the model named in it still decides", async () => {
    expect((await ask("rx410", "how much ventilation clearance do I leave", { earlier: EARLIER })).hits.length).toBeGreaterThan(0);
    expect((await ask("rx410", "what does fault F0004 mean on the RX410", { earlier: EARLIER })).hits.length).toBeGreaterThan(0);
    expect((await ask("rx410", "supply voltage of the RX420", { earlier: EARLIER })).hits).toHaveLength(0);
  });
});

describe("#5671 file names and spellings on the real cover read", () => {
  it("F1: a name carrying BR100 conflicts with the BR200 cover; the matching name is not stripped", async () => {
    const wrong = await ask("br200", "supply voltage of the 1234-BR200");
    expect(wrong.hits).toHaveLength(0);
    expect(wrong.diagnostics.unlistedModelRefusal?.kind).toBe("cover-and-file-disagree");
    expect((await ask("br100", "supply voltage of the 1234-BR100")).hits.length).toBeGreaterThan(0);
  });
  it("F3: the non-breaking-hyphen spelling gets the same near-miss refusal as ASCII, once", async () => {
    for (const q of ["voltage of 2080-LC20-20QWD", "voltage of 2080‑LC20‑20QWD"]) {
      const r = await ask("micro", q);
      expect(r.hits, q).toHaveLength(0);
      expect(r.diagnostics.unlistedModelRefusal?.asked, q).toHaveLength(1);
    }
    expect((await ask("micro", "voltage of 2080‑LC20‑20QWB")).hits.length).toBeGreaterThan(0);
  });
});

// Parent finding (language): the notebook route searches the English corpus with a TRANSLATED query but
// passes the technician's ORIGINAL message as `rawQuery`, which is what subject scope reads. A pointer
// written in Spanish / French / German / Italian / Portuguese must carry the refused subject exactly as
// its English form does; a question of its own in the same languages must stand alone (#5720).
async function askTranslated(raw: string, query: string, earlier: string[] = ["RX420 will not start"]) {
  const m = MANUALS.rx410;
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, TENANT, query, {
    nodeId: `node-${m.key}`, unsPath: null, docIds: [m.doc], validatedDocScope: true, rawQuery: raw,
    identity: { manufacturer: "Northfield", model: "RX410" }, identityStatus: "user_confirmed" as const,
    subjectQueries: earlier, diagnostics,
  } as Parameters<typeof retrieveNodeChunks>[3]);
  return { hits, diagnostics };
}
describe("a pointer in any supported language carries the refused subject; a question of its own stands alone", () => {
  const POINTERS: Array<[string, string, string]> = [
    ["English (control)", "What is the supply voltage of that controller?", "supply voltage"],
    ["Spanish demonstrative", "¿Cuál es el voltaje de alimentación de ese controlador?", "supply voltage"],
    ["Spanish possessive", "¿Y su corriente nominal?", "rated current"],
    ["Spanish clitic", "¿Cómo lo reinicio?", "reset"],
    ["French demonstrative", "Quelle est la tension nominale de ce contrôleur ?", "supply voltage"],
    ["French possessive", "Et son courant nominal ?", "rated current"],
    ["German demonstrative", "Welche Spannung benötigt dieser Controller?", "supply voltage"],
    ["German possessive", "Und was ist sein Nennstrom?", "rated current"],
    ["Italian demonstrative", "Qual è la tensione di alimentazione di questo controllore?", "supply voltage"],
    ["Portuguese demonstrative", "Qual é a tensão de alimentação deste controlador?", "supply voltage"],
  ];
  it.each(POINTERS)("%s keeps the refused RX420 subject (no RX410 page)", async (_n, raw, query) => {
    const r = await askTranslated(raw, query);
    expect(r.hits).toHaveLength(0);
    expect(r.diagnostics.unlistedModelRefusal?.source).toBe("conversation");
  });
  const INDEPENDENT: Array<[string, string, string]> = [
    ["Spanish", "¿Cuánto espacio necesito para la ventilación del gabinete?", "ventilation clearance"],
    ["French", "Quel dégagement de ventilation faut-il laisser autour du boîtier ?", "ventilation clearance"],
    ["German", "Wie viel Platz brauche ich für die Belüftung des Gehäuses?", "ventilation clearance"],
    ["Spanish (owner's phrasing)", "una mas — cuanto espacio necesito detras del panel pa la ventilacion?", "ventilation clearance"],
  ];
  it.each(INDEPENDENT)("%s question with its own topic answers from the current record", async (_n, raw, query) => {
    expect((await askTranslated(raw, query)).hits.length).toBeGreaterThan(0);
  });
  it("a language with no pointer lexicon fails closed: it keeps the refused subject rather than guessing", async () => {
    const r = await askTranslated("Jaki jest wymagany odstęp wentylacyjny wokół obudowy?", "ventilation clearance");
    expect(r.hits).toHaveLength(0);
    expect(r.diagnostics.unlistedModelRefusal?.source).toBe("conversation");
  });
  it("control: with nothing refused before it, the same pointers answer (nothing to carry)", async () => {
    expect((await askTranslated("¿Cuál es el voltaje de alimentación de ese controlador?", "supply voltage", [])).hits.length).toBeGreaterThan(0);
  });
});

// M12 (qualification gap): the project's own RECORD is read as recorded. A confirmed model whose spelling
// is also a register (R4158) or a drive-trip shape (HF100) is still that machine: its own manual answers,
// and a sibling-less foreign manual (RX410) is refused for it. Synthetic products, not real OEM numbers.
// Reachable through the API's confirmed identity (identity + identityStatus user_confirmed).
async function recordAsk(model: string, doc: string, message = "what is the supply voltage", catalogNumber?: string) {
  const diagnostics: Diag = {};
  const hits = await retrieveNodeChunks(client, TENANT, "supply voltage", {
    nodeId: "node-record-shape", unsPath: null, docIds: [doc], validatedDocScope: true, rawQuery: message,
    identity: { manufacturer: "Aster Controls", model }, identityStatus: "user_confirmed" as const, diagnostics,
    ...(catalogNumber ? { catalogNumber } : {}),
  } as Parameters<typeof retrieveNodeChunks>[3]);
  return { hits, diagnostics };
}
describe("a confirmed record shaped like a register or a trip code is still the machine's model", () => {
  it.each(["R4158", "HF100"])("%s: its own manual answers; the other model's manual is refused", async (model) => {
    const doc = `39700000-0000-4000-8000-0000000006c${model === "R4158" ? 1 : 2}`;
    for (const [page, content] of [[1, `Aster Controls ${model} Logic Controller\nHardware User Guide`], [7, `${model} supply voltage 24 V DC.`]] as const) {
      await client.query(
        `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url, page_start, doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', $3, $4, $5, 'v2', jsonb_build_object('node_id', 'node-record-shape', 'filename', $6::text, 'chunk_index', $4::int), true, true)`,
        [TENANT, content, `https://test.invalid/${model}.pdf`, page, doc, `${model}.pdf`],
      );
    }
    expect((await recordAsk(model, doc)).hits.length).toBeGreaterThan(0);
    const other = await recordAsk(model, MANUALS.rx410.doc);
    expect(other.hits).toHaveLength(0);
  });
});

describe("the record is the machine's model even when it is shaped like a trip code (call sites of recordModelNumbers)", () => {
  const HF = "39700000-0000-4000-8000-0000000006c3";
  beforeAll(async () => {
    for (const [page, content] of [[1, "Aster Controls Logic Controller\nHardware User Guide"], [7, "HF100 supply voltage 24 V DC. HF100A supply voltage 48 V DC."]] as const) {
      await client.query(
        `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url, page_start, doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/hf-generic.pdf', $3, $4, 'v2', jsonb_build_object('node_id', 'node-record-shape', 'filename', 'hf-generic.pdf', 'chunk_index', $3::int), true, true)`,
        [TENANT, content, page, HF],
      );
    }
  });
  it("a typed number of the RECORD's family is a sibling of the record, so it is refused (HF100A asked in an HF100 project)", async () => {
    // The sibling rule judges against the confirmed CATALOG number on record.
    const r = await recordAsk("HF100", HF, "what is the supply voltage of the HF100A", "HF100");
    expect(r.hits).toHaveLength(0);
    expect((r.diagnostics as Record<string, unknown>).siblingOfRecordAsk).toBeDefined();
    // Control: the record's own number is not its own sibling.
    expect((await recordAsk("HF100", HF, "what is the supply voltage of the HF100", "HF100")).hits.length).toBeGreaterThan(0);
  });
  it("a safety-stop call-out never lists the record's own number as one the cover omits", async () => {
    const r = await recordAsk("HF100", HF, "what is the supply voltage of the HF100 drive");
    expect(r.hits.length).toBeGreaterThan(0);
    const covers = (r.diagnostics as { admittedCovers?: Record<string, { unlisted: string[] }> }).admittedCovers ?? {};
    expect(Object.keys(covers)).toContain(HF);
    expect(covers[HF].unlisted).toEqual([]);
  });
  it("a trip-shaped number the question calls a product is a model: a look-alike of the cover's model is refused", async () => {
    const COVER = "39700000-0000-4000-8000-0000000006c4";
    for (const [page, content] of [[1, "Aster Controls HF100 Drive\nHardware User Guide"], [7, "HF100 supply voltage 24 V DC."]] as const) {
      await client.query(
        `INSERT INTO knowledge_entries (tenant_id, content, manufacturer, model_number, source_url, page_start, doc_id, ingest_route, metadata, verified, is_private)
         VALUES ($1, $2, '', '', 'https://test.invalid/hf100-guide.pdf', $3, $4, 'v2', jsonb_build_object('node_id', 'node-record-shape', 'filename', 'hf100-guide.pdf', 'chunk_index', $3::int), true, true)`,
        [TENANT, content, page, COVER],
      );
    }
    const asked = (msg: string) => recordAsk("HF100", COVER, msg).then((r) => r.hits.length);
    expect(await asked("what is the supply voltage of the HF110 drive")).toBe(0);
    // Control: the same shape as a BARE fault code is not a model, so the HF100 guide answers.
    expect(await asked("what is the supply voltage, it shows HF110")).toBeGreaterThan(0);
  });
});
