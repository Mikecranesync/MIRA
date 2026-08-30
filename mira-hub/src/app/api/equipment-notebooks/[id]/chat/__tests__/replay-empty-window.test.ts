/**
 * Workstream C (PRD §9.2) — a failed or EMPTY replay ask is refused at the
 * owning seam, provider-free, and persists NO turn.
 *
 * The client contract is "the CTA never renders on an empty/unavailable
 * window", but the route is the authority: a `machineEvidence` request whose
 * served window has zero admissible rows (or whose history source is missing)
 * is answered with a structured 422 — never a document answer wearing a
 * machine-evidence card, never a fabricated `answered` turn, never a 412 that
 * blames approved context. Distinct codes keep "empty" and "unavailable"
 * apart (§9.2 third bullet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const UNS = "enterprise.home_garage.conveyor_lab.conveyor_1";
const FAULT_AT = "2026-08-27T23:16:31.000Z";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })) }));
const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as { filename: string | null }[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);
const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => p),
  buildManualUserContent: vi.fn((q: string) => q),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);
type Handler = [RegExp, { rows: unknown[] } | (() => { rows: unknown[] })];
const dbMock = vi.hoisted(() => ({ handlers: [] as Handler[], calls: [] as { sql: string }[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string) => {
        dbMock.calls.push({ sql });
        for (const [re, res] of dbMock.handlers) if (re.test(sql)) return typeof res === "function" ? res() : res;
        return { rows: [] };
      },
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => undefined) }));
const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

import { POST } from "../route";

function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };
const ME = { assetId: ASSET, anchorAt: FAULT_AT, pre: 60, post: 10 };
const KG_HIT: Handler = [/FROM kg_entities/, { rows: [{ uns_path: UNS }] }];
const STALE: Handler = [/FROM live_signal_cache/, { rows: [] }];
const EVENTS: Handler = [
  /FROM tag_events/,
  { rows: [{ event_timestamp: FAULT_AT, ingested_at: FAULT_AT, uns_path: UNS, tag_path: "cv101/fault_alarm", value: "true", quality: "good" }] },
];
function undefinedTable(): { rows: unknown[] } {
  const e = new Error("no relation") as Error & { code?: string };
  e.code = "42P01";
  throw e;
}
const CHUNK = { content: "P042 sets decel [1]", title: "gs10.pdf", sourceUrl: "u", sourcePage: 3, docId: DOC_A, verified: true };

function providerStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.handlers = [];
  dbMock.calls = [];
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  process.env.GROQ_API_KEY = "k";
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "node-1" });
  nbMock.getNotebook.mockResolvedValue({ id: NB, displayName: "CV-101", manufacturer: null, model: null });
  ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(providerStream("P042 [1]"), { status: 200 })));
});

describe("empty / unavailable replay asks are refused at the seam (§9.2)", () => {
  it("valid window, zero rows → 422 machine_window_empty; no provider call; NO turn persisted (even with documents attached)", async () => {
    dbMock.handlers = [KG_HIT, [/FROM tag_events/, { rows: [] }], [/FROM tag_event_diffs/, { rows: [] }], STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("machine_window_empty");
    expect(body.error).toMatch(/Nothing was recorded in this window/);
    expect(body.coverage).toMatchObject({ recorded: 0, historyAvailable: true, admissible: false });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("tag_events missing → 422 machine_history_unavailable (distinct from empty); nothing persisted", async () => {
    dbMock.handlers = [KG_HIT, [/FROM tag_events/, undefinedTable], STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("machine_history_unavailable");
    expect(body.reason).toBe("unavailable");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("asset without machine memory (no uns_path) → 422 machine_history_unavailable with reason no_uns_path", async () => {
    dbMock.handlers = [[/FROM kg_entities/, { rows: [] }]];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "machine_history_unavailable", reason: "no_uns_path" });
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("the refusal is provider-free even when the approved-context gate is ON (never a 412 for an empty window)", async () => {
    process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL = "true";
    dbMock.handlers = [KG_HIT, [/FROM tag_events/, { rows: [] }], [/FROM tag_event_diffs/, { rows: [] }], STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("machine_window_empty");
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("a TRANSIENT history read failure is 503 machine_history_read_failed — not 'unavailable', nothing persisted", async () => {
    dbMock.handlers = [KG_HIT, [/FROM machine_state_window/, () => { throw new Error("connection reset"); }], STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("machine_history_read_failed");
    expect(body.error).toMatch(/Try again/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(nbMock.recordTurn).not.toHaveBeenCalled();
  });

  it("a NON-empty window is unchanged: 200, answered, machine_history basis, provider called, turn persisted", async () => {
    dbMock.handlers = [KG_HIT, EVENTS, [/FROM tag_event_diffs/, { rows: [] }], STALE];
    const res = await POST(req({ message: "what happened?", sourceDocIds: [DOC_A], machineEvidence: ME }), params);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain('"basis":"machine_history"');
    expect(raw).toContain('"status":"answered"');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(nbMock.recordTurn).toHaveBeenCalledTimes(1);
  });

  it("without machineEvidence the document lane is byte-identical (no machine SQL, 200)", async () => {
    const res = await POST(req({ message: "what is P042?", sourceDocIds: [DOC_A] }), params);
    expect(res.status).toBe(200);
    expect(dbMock.calls.filter((c) => /tag_events|kg_entities/.test(c.sql))).toHaveLength(0);
  });
});
