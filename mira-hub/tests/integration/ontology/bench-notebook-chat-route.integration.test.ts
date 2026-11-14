// Bench runtime context contract — THE PILOT'S CHAT ROUTE ITSELF, on a real database.
//
// WHAT THIS IS: the real POST /api/equipment-notebooks/[id]/chat handler, with the real scope
// validator, real retrieval and real prompt assembly, against a PostgreSQL built from the Hub
// migrations. Only two things are replaced: the signed-in session, and the outbound HTTP call
// to the answer provider (nothing leaves the machine; the request the route WOULD send is
// captured, and a canned streamed reply is returned).
//
// So this proves what the route puts in front of the model, which passage it cites and what it
// records — not what a real model would say. The canned reply is the same text every time
// ("2.4 amps [1]"), so the answer WORDS prove nothing; the citation, the scope and the prompt do. Limits: text-search lane only; the approved-retrieval gate is set on
// (as in the staging configuration); the notebook has no confirmed machine identity; two
// one-passage documents. Tables this test schema lacks (turn_ingress, decision_traces) make
// the route log "capture degraded" and carry on; that telemetry path is not exercised.
//
// Nothing here is CI-enforced. Same disposable database as the other contract files.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Pool } from "pg";

const { testPool, session } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return {
    testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool,
    session: { tenantId: "" },
  };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({
    tenantId: session.tenantId,
    userId: "u-bench-route",
    role: "admin",
    email: "bench@example.local",
    status: "active",
    trialExpiresAt: null,
  })),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const TENANT = "5c09e000-0000-4000-8000-0000000000c1";
const OTHER_TENANT = "5c09e000-0000-4000-8000-0000000000c2";
const NODE = "5c09e000-0000-4000-8000-0000000000ce";
const NB = "5c09e000-3333-4000-8000-0000000000c3";
const PHOTO = "5c09e000-1111-4000-8000-0000000000c0";
const OLD = "5c09e000-2222-4000-8000-0000000000c5"; // first reading — superseded
const NEW = "5c09e000-2222-4000-8000-0000000000c6"; // corrected reading — current
const REJECTED = "5c09e000-2222-4000-8000-0000000000c7";
const OLD_TEXT = "Nameplate reading: rated current 4.2 amps, serial number 49849";
const NEW_TEXT = "Nameplate reading: rated current 2.4 amps, serial number 49849";
const REJECTED_TEXT = "Nameplate reading: rated current 9.9 amps, serial number 49849";
const QUESTION = "what is the rated current on the nameplate";

async function cleanup() {
  for (const t of ["equipment_notebook_turns", "equipment_notebook_sources", "equipment_notebooks", "knowledge_entries", "namespace_direct_uploads"]) {
    await testPool.query(`DELETE FROM ${t} WHERE tenant_id = $1::uuid`, [TENANT]);
  }
  await testPool.query(`DELETE FROM hub_uploads WHERE tenant_id = $1`, [TENANT]);
}

let sent: string[] = [];

/** One turn through the real route. Returns the status, the streamed events and what was sent to the provider. */
async function ask(sourceDocIds: string[], tenantId = TENANT) {
  session.tenantId = tenantId;
  sent = [];
  const res = await POST(
    new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: QUESTION, sourceDocIds }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  const text = await res.text();
  const events = text
    .split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  return { status: res.status, text, events, prompt: sent.join("\n") };
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required.");
  if (process.env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") {
    throw new Error("Refusing to run against a non-disposable database.");
  }
  process.env.GROQ_API_KEY = "test-not-a-key"; // the provider call is stubbed below; this only selects a provider
  process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
  delete process.env.NOTEBOOK_HYBRID_RETRIEVAL;
  delete process.env.NOTEBOOK_LEXICAL_V2;

  await cleanup();
  const c = testPool;
  await c.query(
    `ALTER TABLE knowledge_entries
       ADD COLUMN IF NOT EXISTS doc_id uuid,
       ADD COLUMN IF NOT EXISTS embedding text,
       ADD COLUMN IF NOT EXISTS content_tsv tsvector
         GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED`,
  );
  await c.query(
    `INSERT INTO equipment_notebooks (id, tenant_id, display_name, node_id)
     VALUES ($1::uuid, $2::uuid, 'Bench drive (route contract)', $3::uuid)`,
    [NB, TENANT, NODE],
  );
  await c.query(
    `INSERT INTO namespace_direct_uploads (id, tenant_id, filename, mime_type, source)
     VALUES ($1::uuid, $2::uuid, 'plate.jpg', 'image/jpeg', 'nameplate_photo')`,
    [PHOTO, TENANT],
  );
  const rows: Array<[string, string, string, boolean, string | null, number]> = [
    [OLD, OLD_TEXT, "user_confirmed", true, PHOTO, 60],
    [NEW, NEW_TEXT, "user_confirmed", false, PHOTO, 5],
    [REJECTED, REJECTED_TEXT, "rejected", false, null, 30],
  ];
  for (const [doc, text, state, superseded, origin, age] of rows) {
    await c.query(
      `INSERT INTO hub_uploads (id, tenant_id, filename, status, provider)
       VALUES ($1::uuid, $2, 'nameplate.txt', 'parsed', 'itest')`,
      [doc, TENANT],
    );
    await c.query(
      `INSERT INTO equipment_notebook_sources
         (notebook_id, doc_id, tenant_id, enabled_by_default, match_state, origin_file_id, superseded_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, true, $4, $5::uuid,
               CASE WHEN $6 THEN now() ELSE NULL END, now() - make_interval(mins => $7))`,
      [NB, doc, TENANT, state, origin, superseded, age],
    );
    await c.query(
      `INSERT INTO knowledge_entries
         (tenant_id, doc_id, content, source_page, page_start, is_private, verified, source_type,
          manufacturer, model_number, ingest_route, metadata)
       VALUES ($1::uuid, $2::uuid, $3, 1, 1, true, false, 'equipment_manual', '', '', 'v2', '{"chunk_index":0}')`,
      [TENANT, doc, text],
    );
  }
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(typeof init?.body === "string" ? init.body : "");
      const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body =
        frame({ choices: [{ delta: { content: "The nameplate rated current is 2.4 amps [1]." } }] }) +
        frame({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "data: [DONE]\n\n";
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanup();
  await testPool.end();
});

describe("pilot path, real chat route: a corrected reading replaces the old one in what the model is shown", () => {
  it("asked with the SUPERSEDED reading's id, the route shows the model only the corrected reading", async () => {
    const turn = await ask([OLD]);
    expect(turn.status).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
    expect(turn.prompt).toContain("2.4 amps");
    expect(turn.prompt).not.toContain("4.2 amps");
    const sources = turn.events.find((e) => e.kind === "sources");
    expect(sources?.sourceSnapshot).toEqual([NEW]);
    expect(turn.text).not.toContain(OLD);
  });

  it("the answer the route returns and RECORDS cites the corrected reading and its photograph, never the old one", async () => {
    await testPool.query(`DELETE FROM equipment_notebook_turns WHERE tenant_id = $1::uuid`, [TENANT]);
    const turn = await ask([OLD]);
    const sources = turn.events.find((e) => e.kind === "sources") as { citations: Array<Record<string, unknown>> };
    expect(sources.citations).toHaveLength(1);
    expect(sources.citations[0]).toMatchObject({ docId: NEW, originFileId: PHOTO, quote: NEW_TEXT, page: 1 });
    expect(turn.events.find((e) => e.kind === "status")).toMatchObject({ status: "answered" });
    expect(turn.events.find((e) => e.kind === "evidence")).toMatchObject({ basis: "workspace_evidence" });

    const saved = await testPool.query(
      `SELECT answer_status, answer_text, enabled_source_doc_ids, evidence, owner_user_id
         FROM equipment_notebook_turns WHERE tenant_id = $1::uuid AND notebook_id = $2::uuid`,
      [TENANT, NB],
    );
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0].answer_status).toBe("answered");
    expect(saved.rows[0].enabled_source_doc_ids).toEqual([NEW]);
    expect(saved.rows[0].evidence).toHaveLength(1);
    expect(saved.rows[0].evidence[0]).toMatchObject({ docId: NEW, originFileId: PHOTO });
    expect(JSON.stringify(saved.rows[0])).not.toContain(OLD);
    expect(JSON.stringify(saved.rows[0])).not.toContain("4.2 amps");
  });

  it("control: the same request while the old reading is still current DOES show the model the old reading", async () => {
    await testPool.query(
      `UPDATE equipment_notebook_sources SET superseded_at = NULL WHERE notebook_id = $1::uuid AND doc_id = $2::uuid`,
      [NB, OLD],
    );
    try {
      const turn = await ask([OLD]);
      expect(turn.status).toBe(200);
      expect(turn.prompt).toContain("4.2 amps");
    } finally {
      await testPool.query(
        `UPDATE equipment_notebook_sources SET superseded_at = now() WHERE notebook_id = $1::uuid AND doc_id = $2::uuid`,
        [NB, OLD],
      );
    }
  });

  it("the old reading is retained: its source row and its passage are still in the database", async () => {
    const src = await testPool.query(
      `SELECT superseded_at IS NOT NULL AS superseded FROM equipment_notebook_sources WHERE notebook_id = $1::uuid AND doc_id = $2::uuid`,
      [NB, OLD],
    );
    const passage = await testPool.query(`SELECT content FROM knowledge_entries WHERE doc_id = $1::uuid`, [OLD]);
    expect(src.rows).toEqual([{ superseded: true }]);
    expect(passage.rows).toEqual([{ content: OLD_TEXT }]);
  });
});

describe("pilot path, real chat route: refusals happen before the model is called", () => {
  it("a rejected source is refused and nothing is sent to the model", async () => {
    const turn = await ask([REJECTED]);
    expect(turn.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("a rejected source alongside a good one takes the whole request down", async () => {
    const turn = await ask([NEW, REJECTED]);
    expect(turn.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("another tenant asking about this notebook is refused and nothing is sent to the model", async () => {
    const turn = await ask([NEW], OTHER_TENANT);
    expect(turn.status).toBeGreaterThanOrEqual(400);
    expect(sent).toEqual([]);
    expect(turn.text).not.toContain("amps");
  });

  it("positive control: this tenant's good source is answered, and the corrected text reaches the model", async () => {
    const turn = await ask([NEW]);
    expect(turn.status).toBe(200);
    expect(turn.prompt).toContain("2.4 amps");
    expect(turn.prompt).not.toContain("9.9 amps");
  });
});
