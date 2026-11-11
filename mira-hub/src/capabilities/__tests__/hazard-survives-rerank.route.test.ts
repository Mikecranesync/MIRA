/**
 * #5370, through the real chat route and the real search code.
 *
 * hazard-survives-rerank.test.ts proves the rule on what search returns. This file asks one step
 * further: is the manual's warning in the text the model is sent? The route, the search and the
 * prompt builder are the real ones. The database, the session, the reranker and the model provider
 * are stand-ins. No network, $0.
 *
 * Passages are short stand-ins written for this test, not manual excerpts.
 *
 * Not proven here: a real reranker's scores, a real model's answer, or anything on a screen.
 *
 * Run: npx vitest run src/capabilities/__tests__/hazard-survives-rerank.route.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LOCKOUT_PAGE_QUERY } from "@/capabilities/energized-work-stop";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: "unbound" })),
  recordTurn: vi.fn(async () => "turn-row"),
  listTurns: vi.fn(async () => [] as unknown[]),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));

// Search is REAL. Only its entry point is wrapped, so the test can read what the route handed it.
const searchCalls = vi.hoisted(() => ({ list: [] as { query: string; rawQuery?: string }[] }));
vi.mock("@/lib/manual-rag", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/manual-rag")>();
  return {
    ...real,
    retrieveNodeChunks: (...args: Parameters<typeof real.retrieveNodeChunks>) => {
      searchCalls.list.push({ query: args[2], rawQuery: args[3]?.rawQuery });
      return real.retrieveNodeChunks(...args);
    },
  };
});

// The database stand-in offers the same seventeen passages to every passage search.
const db = vi.hoisted(() => ({ rows: () => [] as Record<string, unknown>[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) =>
        sql.includes("WITH ORDINALITY") || sql.includes("names_document") || sql.includes("quote_literal(lex)")
          || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)
          ? { rows: [] }
          : { rows: db.rows() },
      ),
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => true),
  canonicalProviders: vi.fn(() => [{ name: "stand-in", url: "https://provider.invalid/v1", key: "k", model: "m" }]),
  buildRequestBody: vi.fn((provider: { model: string }, messages: unknown) => ({ model: provider.model, messages, stream: true })),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage", provider: "stand-in" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const mk = (page: number, content: string, rank: number) => ({
  content,
  doc_id: DOC,
  source_url: "node-doc/u1/starter.pdf",
  source_page: page,
  page_start: page,
  section_path: null,
  filename: "starter.pdf",
  document_heading: "Soft Starter User Manual",
  verified: false,
  rank,
});

const WARNING_OFF_STATE = "SHOCK HAZARD: Hazardous voltage is present at the motor terminals even when the starter is stopped. Disconnect main power before servicing.";
const WARNING_CAPACITOR = "WARNING: Hazardous voltage remains on the motor terminals of the starter. Wait five minutes for the capacitors to discharge.";
const WARNING_BYPASS = "DANGER: Hazardous voltage is live on the starter bypass terminals when the motor is stopped. Verify zero energy.";
// Same shape as hazard-survives-rerank.test.ts: two non-warning passages lead plain search, the
// three warnings follow inside the eight kept. A fresh copy per query: search edits rank fields.
const rows17 = () => [
  mk(901, "Starter troubleshooting: if a dangerous voltage or shock hazard indication shows while the motor terminals carry voltage and the starter is stopped, check the wiring.", 0.95),
  mk(902, "Motor terminals of the starter: voltage ratings, shock and vibration limits, hazard labels and dangerous-goods data for each frame.", 0.93),
  mk(911, WARNING_CAPACITOR, 0.5),
  mk(912, WARNING_BYPASS, 0.38),
  mk(913, WARNING_OFF_STATE, 0.08),
  mk(903, "Starter stopped state: the display shows STOPPED and the motor terminals are not driven.", 0.91),
  mk(904, "Starter terminals: motor terminal torque is 2.5 N·m; line terminal torque is 3.0 N·m.", 0.86),
  mk(905, "Motor connection diagram for the starter: terminals T1, T2 and T3 go to the motor.", 0.8),
  ...[921, 922, 923, 924, 925, 926, 927, 928, 929].map((p, i) =>
    mk(p, `Starter setup note ${i + 1}: the motor terminals and the stopped state are described in the installation chapter.`, 0.3 - i * 0.02),
  ),
];
/** The reranker likes the setup notes and two of the warnings, and scores the off-state warning last. */
const demotesOffStateWarning = (p: string) =>
  p === WARNING_OFF_STATE ? -10 : p.startsWith("Starter setup note") ? 5 : p === WARNING_CAPACITOR || p === WARNING_BYPASS ? 6 : 0;

// A hazard-shaped question the energized-work stop does not catch, so it is answered by the model.
const ANSWERED_HAZARD_QUESTION = "Is the starter output still energized after a stop?";
// One the stop does catch: no model is asked.
const STOPPED_HAZARD_QUESTION = "The starter is stopped. Are the motor terminals still live?";

type Reranker = "demotes the off-state warning" | "down";
async function ask(message: string, reranker: Reranker) {
  const sentToModel: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes("mira-reranker")) {
        if (reranker === "down") return new Response("down", { status: 503 });
        const { passages } = JSON.parse(String(init.body)) as { passages: string[] };
        return new Response(JSON.stringify({ scores: passages.map(demotesOffStateWarning) }), { status: 200 });
      }
      sentToModel.push(String(init.body));
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "Treat the terminals as live [1]." } }] })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  );
  const res = await POST(
    new NextRequest("http://test/api/equipment-notebooks/x/chat", {
      method: "POST",
      body: JSON.stringify({ message, sourceDocIds: [DOC] }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: NB }) },
  );
  expect(res.status).toBe(200);
  const frames = (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.startsWith("data: [DONE]"))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  return { sentToModel, kinds: frames.map((f) => String(f.kind)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  searchCalls.list = [];
  vi.stubEnv("NOTEBOOK_SEMANTIC_CHECK", "0");
  vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
  vi.stubEnv("RERANKER_URL", "http://mira-reranker:8088");
  vi.stubEnv("NOTEBOOK_RERANK_POOL", "");
  vi.stubEnv("NOTEBOOK_RERANK", "1");
  vi.stubEnv("NEON_DATABASE_URL", "postgres://test");
  db.rows = rows17;
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC], nodeId: "n1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Soft starter", manufacturer: null, model: null, catalogNumber: null, identityStatus: "unknown" });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a hazard question the model answers, with re-ordering on", () => {
  it("fixture: with the reranker down, plain search puts the off-state warning in the text sent to the model", async () => {
    const { sentToModel } = await ask(ANSWERED_HAZARD_QUESTION, "down");
    expect(sentToModel).toHaveLength(1);
    expect(sentToModel[0]).toContain("even when the starter is stopped");
  });

  it("the reranker scores that warning last, and it is still in the text sent to the model", async () => {
    const { sentToModel } = await ask(ANSWERED_HAZARD_QUESTION, "demotes the off-state warning");
    expect(sentToModel).toHaveLength(1);
    expect(sentToModel[0]).toContain("even when the starter is stopped");
  });
});

describe("a hazard question the safety stop catches, with re-ordering on", () => {
  // Both searches made from the question are handed it. The stop's lockout-page search is made
  // with fixed lockout words and is not covered by the rule (stated scope).
  it("no model is asked, and the searches made from the question carry the technician's own words", async () => {
    const { sentToModel, kinds } = await ask(STOPPED_HAZARD_QUESTION, "demotes the off-state warning");
    expect(sentToModel).toHaveLength(0);
    expect(kinds).toContain("safety");
    const fromQuestion = searchCalls.list.filter((c) => c.query.startsWith(STOPPED_HAZARD_QUESTION));
    expect(fromQuestion).toHaveLength(2);
    for (const c of fromQuestion) expect(c.rawQuery).toBe(STOPPED_HAZARD_QUESTION);
    expect(searchCalls.list.filter((c) => !c.query.startsWith(STOPPED_HAZARD_QUESTION)).map((c) => c.rawQuery)).toEqual([LOCKOUT_PAGE_QUERY]);
  });
});
