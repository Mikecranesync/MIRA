/**
 * Photo-to-manual (#5706, tablet walk 2026-11-21 on staging 7401002fc): in a
 * project confirmed as AutomationDirect GS11N-20P2 with the GS10 manual
 * enabled, a nameplate photo of a DIFFERENT drive (GS20-23P0) plus "Find me
 * the manual" was answered from the GS10 manual. The photo had been read
 * correctly; retrieval never saw it, so the project's machine scoped the ask.
 *
 * This turn's photo reading is the asked machine when the typed question names
 * no model — judged by the same coverage check a typed model gets. Photo
 * readings below are the real staging observations, verbatim.
 *
 * Run: TEST_DATABASE_URL=… MIRA_TEST_DB_CONFIRM=DISPOSABLE npx vitest run --config vitest.integration.config.ts src/lib/__tests__/manual-rag-photo-model
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { retrieveNodeChunks } from "../manual-rag";

vi.hoisted(() => {
  process.env.NODE_EMBED_ON_WRITE = "0";
  process.env.NOTEBOOK_HYBRID_RETRIEVAL = "0";
  process.env.NOTEBOOK_RERANK = "0";
});

const TENANT = "39700000-0000-4000-8000-0000000005a0";
const DOC = "39700000-0000-4000-8000-0000000005a1";
const NODE = "photo-model";

// Staging observation of the tablet walk's photo (turn b6429301, 2026-11-21).
const GS20_PHOTO =
  'A light blue/gray printed cover or sheet fills the frame, bordered by a thin double-line rectangular frame. Near the upper left is the blue text "AutomationDirect". Below it, in black text, are lines reading "GS20-23P0", "AC Variable Frequency Drive", "Input 3Ph 230VAC 3HP 11.2A", "Output 3Ph 0-230V 60Hz 9.6A", and "S/N: GS20-US-0031482". No connectors, wiring, indicators, damage, debris, or moisture are visible.';
// Staging observation of the archived CV-101 photo (notebook aca65409, 2026-11-07).
const GS11N_PHOTO =
  'Black rectangular drive mounted vertically on a metal panel. Front left edge has a small keypad area with a round black knob at the top, a red glowing indicator near it, a green square indicator below, two small white buttons marked with up and down triangles, and labels "MENU" and "ENTER". The main side label is mostly readable and shows "MODEL: GS11N-20P2". Other readable text on the label includes "INPUT: VT: 1PH 200-240V 50/60Hz 5.8A" and "CT: 1PH 200-240V 50/60Hz 5.1A"; "OUTPUT: POWER VT(CT) 0.25HP(0.25HP)"; "VT: 3PH 0-230V 1.8A 0.7KVA 0.2KW"; "CT: 3PH 0-230V 1.6A 0.6KVA 0.2KW"; "FREQUENCY RANGE: 0-599Hz"; "SHORT CIRCUIT CURRENT: 100KA"; "AutomationDirect.com"; "MADE IN INDIA"; "Ver. 1.03". A barcode area shows "GS1120P2+K25310021". The small QR-like code on the side is not readable. Blue and light-colored cables run past the right side of the unit. No loose or disconnected wiring is visible. No burn marks, corrosion, moisture, or debris are clearly visible on the unit. The exact meaning of the barcode string and the partially visible side code are unclear from the photo.';
// Staging observation of a whole-panel photo from the same notebook: several
// devices, so it names no single machine.
const PANEL_PHOTO =
  'A mounted black board with several industrial control parts, wire terminals, and a pushbutton panel. Left side has a large dark green/black module partly visible with a slot and a blue tab; a smaller silver panel behind it has a label with partially readable text ending in "1AB60". Lower left is a white Schneider Electric plug-in module labeled "MLC" with multiple numbered terminals and several wires attached. Center lower is a black AutomationDirect DuraPulse GS10 drive; its red display shows "F30.0". Top center is a white MW power supply labeled "100-240VAC", "0.55A", "50/60Hz", with green "DC OK" lit. Next to it is a gray Allen-Bradley Micro820 module with several small green indicator LEDs lit and multiple wires connected at the top and bottom; a gray cover beside it is hand-marked "PMC V1.0".';
// A plate the camera could not read: no model at all.
const UNREADABLE_PHOTO = "A drive label photographed at an angle with heavy glare; the text on the label is not readable. A keypad with MENU and ENTER is visible.";

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
  // The staging GS10 manual's opening pages (verbatim cover), plus the model
  // table page that lists GS11N-20P2 and a body page about the manual itself.
  const pages: Array<[number, string]> = [
    [1, "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions"],
    [3, "DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nWarnings and Trademarks\nThank you for purchasing automation equipment from Automationdirect.com. Anyone who installs or uses this equipment should read this manual before installing or operating the equipment."],
    [26, "DURApulse GS10 model number explanation and drive specifications. Model GS11N-20P2 1-phase 230V 0.25 hp. Model GS11N-20P5 0.5 hp. Model GS13N-21P0 1 hp. This manual covers installation, wiring, parameters and troubleshooting."],
  ];
  for (const [page, content] of pages) {
    await client.query(
      `INSERT INTO knowledge_entries
        (tenant_id, content, manufacturer, model_number, source_url, page_start,
         doc_id, ingest_route, metadata, verified, is_private)
       VALUES ($1, $2, '', '', 'https://test.invalid/gs10usermanual.pdf', $3, $4, 'v2',
         jsonb_build_object('node_id', $5::text, 'filename', 'gs10usermanual.pdf', 'chunk_index', $3::int), true, true)`,
      [TENANT, content, page, DOC, NODE],
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

type Diagnostics = {
  namedModelMismatch?: { requested: string[]; declared: string[]; source?: string };
  siblingOfRecordAsk?: { asked: string[]; record: string; source?: string };
} & Record<string, unknown>;

async function ask(message: string, photoText?: string, catalogNumber?: string, earlier?: { subjectQueries?: string[]; subjectOutOfReach?: boolean }) {
  const diagnostics: Diagnostics = {};
  const hits = await retrieveNodeChunks(client, TENANT, message, {
    nodeId: NODE,
    unsPath: null,
    docIds: [DOC],
    validatedDocScope: true,
    rawQuery: message,
    identity: { manufacturer: "AutomationDirect", model: "GS11N-20P2" },
    identityStatus: "user_confirmed",
    diagnostics,
    ...(catalogNumber ? { catalogNumber } : {}),
    ...(earlier ?? {}),
    ...(photoText !== undefined ? { photoText } : {}),
  } as Parameters<typeof retrieveNodeChunks>[3]);
  return { hits, diagnostics };
}

describe("typed model: the existing coverage check (control for the photo path)", () => {
  it("refuses the GS10 manual for a typed GS20-23P0 and names the mismatch", async () => {
    const { hits, diagnostics } = await ask("Find me the manual for AutomationDirect GS20-23P0");
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch?.requested).toContain("GS20");
  });

  it("serves the GS10 manual for the project's own typed model", async () => {
    const { hits } = await ask("Find me the manual for AutomationDirect GS11N-20P2");
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("this turn's photo is the asked machine when the question names none", () => {
  it("refuses the GS10 manual for a GS20-23P0 nameplate photo and names the mismatch", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", GS20_PHOTO);
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch?.requested).toContain("GS20");
    expect(diagnostics.namedModelMismatch?.source).toBe("photo");
    // The plate's serial (S/N: GS20-US-0031482) is never read as a model.
    expect(diagnostics.namedModelMismatch?.requested.some((id) => /US/.test(id))).toBe(false);
  });

  // With no catalog number on record the family manual covers every GS11N
  // variant, for a typed number and a photographed one alike.
  it("a look-alike plate gets the same outcome its typed number gets (no catalog number on record)", async () => {
    const lookAlike = GS11N_PHOTO.replace("GS11N-20P2", "GS11N-20P5");
    const typed = await ask("Find me the manual for AutomationDirect GS11N-20P5");
    const photo = await ask("Find me the manual", lookAlike);
    expect(photo.hits.length).toBe(typed.hits.length);
    expect(photo.diagnostics.namedModelMismatch).toEqual(typed.diagnostics.namedModelMismatch);
  });

  // The look-alike guard: with GS11N-20P2 on record, a sibling's values are
  // never given from this project's manual — typed (control) or photographed.
  it("refuses a look-alike plate when the project's catalog number is on record", async () => {
    const lookAlike = GS11N_PHOTO.replace("GS11N-20P2", "GS11N-20P5");
    const typed = await ask("Find me the manual for AutomationDirect GS11N-20P5", undefined, "GS11N-20P2");
    expect(typed.hits).toEqual([]);
    expect(typed.diagnostics.siblingOfRecordAsk?.source).toBeUndefined();
    const photo = await ask("Find me the manual", lookAlike, "GS11N-20P2");
    expect(photo.hits).toEqual([]);
    expect(photo.diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS11N-20P5"], record: "GS11N-20P2", source: "photo" });
  });

  it("the photo is newer than every earlier question: a sibling asked before does not carry past it", async () => {
    const earlier = { subjectQueries: ["Find me the manual for AutomationDirect GS11N-20P5"] };
    const carried = await ask("Find me the manual", undefined, "GS11N-20P2", earlier);
    expect(carried.hits).toEqual([]); // control: with no photo the earlier sibling is still the subject
    const { hits, diagnostics } = await ask("Find me the manual", GS11N_PHOTO, "GS11N-20P2", earlier);
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
  });

  it("a photo naming several devices leaves the earlier question as the subject", async () => {
    const earlier = { subjectQueries: ["Find me the manual for AutomationDirect GS11N-20P5"] };
    const { hits, diagnostics } = await ask("Find me the manual", PANEL_PHOTO, "GS11N-20P2", earlier);
    expect(hits).toEqual([]);
    expect(diagnostics.siblingOfRecordAsk?.asked).toEqual(["GS11N-20P5"]);
    expect(diagnostics.siblingOfRecordAsk?.source).toBeUndefined();
  });

  it("a photo that names the machine is a start, even when earlier turns are out of reach", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", GS20_PHOTO, undefined, { subjectOutOfReach: true });
    expect(hits).toEqual([]);
    expect(diagnostics.subjectOutOfReach).toBeUndefined();
    expect(diagnostics.namedModelMismatch?.source).toBe("photo");
  });

  // Codex r1 on #5764 F1: close-name models the single token cannot carry are
  // read from a photo exactly as from a typed question.
  it.each([
    ["PowerFlex 4M", "Nameplate: Allen-Bradley PowerFlex 4M AC drive."],
    ["SMC-50", "Nameplate: Allen-Bradley SMC-50 solid-state controller."],
  ])("a %s plate is refused like the same model typed", async (model, reading) => {
    const typed = await ask(`Find me the manual for ${model}`);
    const photo = await ask("Find me the manual", reading);
    expect(typed.hits).toEqual([]);
    expect(photo.hits).toEqual([]);
    expect(photo.diagnostics.namedModelMismatch?.requested).toEqual(typed.diagnostics.namedModelMismatch?.requested);
    expect(photo.diagnostics.namedModelMismatch?.source).toBe("photo");
  });

  // Codex r1 F2: two numbers of one family are two machines, so the photo
  // names no single subject and the earlier question stays in force.
  it("a photo naming two GS20 drives leaves the earlier question as the subject", async () => {
    const earlier = { subjectQueries: ["Find me the manual for AutomationDirect GS11N-20P5"] };
    const twoDrives = 'A panel with two drives labeled "GS20-23P0" and "GS20-21P0".';
    const { hits, diagnostics } = await ask("Find me the manual", twoDrives, "GS11N-20P2", earlier);
    expect(hits).toEqual([]);
    expect(diagnostics.siblingOfRecordAsk).toEqual({ asked: ["GS11N-20P5"], record: "GS11N-20P2" });
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  // Codex r1 F4: nothing after a serial label is read as a model.
  it("a model-shaped serial names no machine and does not refuse the project's manual", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", 'The plate model is not readable; the only readable field is "S/N: PF 525".');
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a readable model field decides, not a different model-shaped serial after it", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", 'Label: "MODEL: GS20-23P0", "S/N: GS11N 20P2".');
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch?.requested).toContain("GS20-23P0");
    expect(diagnostics.namedModelMismatch?.requested.some((id) => id.startsWith("GS11N"))).toBe(false);
    const own = await ask("Find me the manual", 'Label: "MODEL: GS11N-20P2", "S/N: GS20 23P0".');
    expect(own.hits.length).toBeGreaterThan(0);
    expect(own.diagnostics.namedModelMismatch).toBeUndefined();
  });

  // Codex r1 F5: a follow-up carries the photo's machine (conversation-subject
  // folds the photo into the open question; manual-rag judges it as typed).
  it("a follow-up after the photo refusal is still about the photo's machine", async () => {
    const { hits, diagnostics } = await ask("What's its rated current?", undefined, undefined, {
      subjectQueries: ["Find me the manual\nGS20-23P0"],
    });
    expect(hits).toEqual([]);
    expect(diagnostics.namedModelMismatch?.requested).toContain("GS20-23P0");
    const back = await ask("What's the rated current of the GS11N-20P2?", undefined, undefined, {
      subjectQueries: ["Find me the manual\nGS20-23P0"],
    });
    expect(back.hits.length).toBeGreaterThan(0);
  });

  it("control: the project's own plate is served when its catalog number is on record", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", GS11N_PHOTO, "GS11N-20P2");
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.siblingOfRecordAsk).toBeUndefined();
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: the same question with no photo serves the project's manual", async () => {
    const { hits, diagnostics } = await ask("Find me the manual");
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: a photo of the project's own GS11N-20P2 plate serves the GS10 manual", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", GS11N_PHOTO);
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: a whole-panel photo naming several devices names no single machine", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", PANEL_PHOTO);
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("control: an unreadable plate names no machine", async () => {
    const { hits, diagnostics } = await ask("Find me the manual", UNREADABLE_PHOTO);
    expect(hits.length).toBeGreaterThan(0);
    expect(diagnostics.namedModelMismatch).toBeUndefined();
  });

  it("a model typed in the question outranks the photo", async () => {
    const own = await ask("Find me the manual for AutomationDirect GS11N-20P2", GS20_PHOTO);
    expect(own.hits.length).toBeGreaterThan(0);
    const other = await ask("Find me the manual for AutomationDirect GS20-23P0", GS11N_PHOTO);
    expect(other.hits).toEqual([]);
    expect(other.diagnostics.namedModelMismatch?.source).toBeUndefined();
  });
});
