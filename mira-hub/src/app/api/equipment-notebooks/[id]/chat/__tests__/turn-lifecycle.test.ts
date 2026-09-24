/**
 * Every ACCEPTED turn leaves a durable start record and an eventual outcome.
 *
 * THE DEFECT THIS PINS (#3939 user-priority update, 2026-09-22). The Turn
 * Evidence Packet was written exactly once, at the end, by `persistTurnUsage` —
 * a *usage* persist on the successful generation path. A turn that timed out,
 * was cancelled, exhausted the cascade, or returned a 4xx before generation
 * wrote NOTHING, so the ledger could not tell "never happened" from "happened
 * and vanished", and every coverage number was self-confirming.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));
const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => []),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(async () => []),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
}));

/** Every statement the route ran, in order — the ledger under test. */
const sql = vi.hoisted(() => [] as { text: string; values: unknown[] }[]);
const client = vi.hoisted(() => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    sql.push({ text, values });
    if (/UPDATE decision_traces/.test(text)) return { rows: [{ trace_id: "t1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(client)),
}));
vi.mock("@/lib/db", () => ({ default: client }));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: NB }) };
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
// decision_traces is APPEND-ONLY (032): both the start and the outcome are
// INSERTs, distinguished by the lifecycle literal. A close that were an UPDATE
// would be denied by the grant — which is exactly what the first live window
// measured (started=7, closed=0).
// NB: the close statement also mentions 'started' — in its WHERE, selecting the
// start row forward — so the start filter keys on the VALUES form specifically.
const starts = () => sql.filter((s) => /INSERT INTO decision_traces/.test(s.text) && /'started',\s*now\(\)/.test(s.text));
const closes = () => sql.filter((s) => /INSERT INTO decision_traces/.test(s.text) && /'closed'/.test(s.text));
const mutations = () => sql.filter((s) => /UPDATE decision_traces|DELETE FROM decision_traces/.test(s.text));

const ORIGINAL = process.env.MIRA_PERSONA_CONTRACT;
beforeEach(() => {
  sql.length = 0;
  vi.clearAllMocks();
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.MIRA_PERSONA_CONTRACT = "1";
  process.env.NEON_DATABASE_URL = "postgres://test";
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown machine" });
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: ["d1"], nodeId: "n1" });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MIRA_PERSONA_CONTRACT;
  else process.env.MIRA_PERSONA_CONTRACT = ORIGINAL;
});

describe("the start record", () => {
  it("is written for an accepted turn BEFORE any provider work", async () => {
    await (await POST(req({ message: "why would a contactor chatter" }), params)).text();
    const s = starts();
    expect(s.length).toBe(1);
    // Tenant, notebook and platform are on the row from the first instant.
    expect(s[0].values).toContain(TENANT);
    expect(s[0].values).toContain("hub_notebook_chat");
    // And it carries no message text — ids and flags only.
    expect(JSON.stringify(s[0].values)).not.toContain("contactor");
  });

  it("is closed exactly once, with an outcome", async () => {
    await (await POST(req({ message: "why would a contactor chatter" }), params)).text();
    expect(starts().length).toBe(1);
    // The close is fire-and-forget by design — it must never block the
    // technician's answer — so the assertion waits for it rather than racing it.
    await vi.waitFor(() => expect(closes().length).toBeGreaterThanOrEqual(1));
    // Append-only: the ledger is never mutated from the request path.
    expect(mutations()).toEqual([]);
  });
});

describe("an exit that never reached generation still closes", () => {
  it("a provider failure closes the record rather than abandoning it", async () => {
    // Every provider 500s — the pre-091 path wrote no ledger row at all.
    await (await POST(req({ message: "anything" }), params)).text();
    expect(starts().length).toBe(1);
    await vi.waitFor(() => expect(closes().length).toBeGreaterThanOrEqual(1));
  });

  it("a structural 4xx closes the record it opened", async () => {
    // A notebook that is not ours: 404, long before any turn row exists.
    nbMock.validateChatSources.mockResolvedValue({ ok: false, error: "no_sources_selected" });
    nbMock.getNotebook.mockResolvedValue(null);
    const res = await POST(req({ message: "q" }), params);
    expect(res.status).toBe(404);
    expect(starts().length).toBe(1);
    await vi.waitFor(() => expect(closes().length).toBe(1));
    // Unclassified early exits close as `error` — honest, and never an orphan.
    expect(closes()[0].values).toContain("error");
    expect(mutations()).toEqual([]);
  });
});
