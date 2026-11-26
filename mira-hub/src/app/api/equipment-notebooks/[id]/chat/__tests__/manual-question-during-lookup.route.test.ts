/**
 * #5746 (Mike, 2026-11-26): the chat route holds no question for the project's manual. A manual
 * question asked while the lookup runs is answered the way main answers it, and a send that starts
 * the lookup gets main's "still looking" reply. Drives the real handler; the database, the status
 * read and the provider are seams. Each case sends the header an earlier draft of this PR used, to
 * show the route ignores it.
 *
 * Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/manual-question-during-lookup.route.test.ts"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const DOC_READY = "55555555-5555-4555-8555-555555555555";
const THREAD = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const PHOTO = "44444444-4444-4444-8444-444444444444";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);
const benchStore = vi.hoisted(() => ({
  getSelectionState: vi.fn(async () => ({ selection: null, version: null })),
  stampTurnComponent: vi.fn(async () => true),
}));
const chatTurn = vi.hoisted(() => ({ resolveComponentTurn: vi.fn() }));
vi.mock("@/capabilities/bench-components/chat-turn", async (orig) => {
  const real = await orig<typeof import("@/capabilities/bench-components/chat-turn")>();
  chatTurn.resolveComponentTurn.mockImplementation(real.resolveComponentTurn);
  return { ...real, resolveComponentTurn: chatTurn.resolveComponentTurn };
});
vi.mock("@/capabilities/bench-components/store", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...benchStore,
}));

const GS10 = {
  id: NB,
  displayName: "GS10 drive",
  manufacturer: "AutomationDirect",
  model: "GS10",
  catalogNumber: null,
  identityStatus: "user_confirmed",
  nodeId: "n1",
};
const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({ status: "claimed" as const, claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
  recordTurn: vi.fn(async () => "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  getNotebook: vi.fn(async () => null as unknown),
  listSources: vi.fn(async () => [{ filename: "GS10.pdf", docId: "33333333-3333-4333-8333-333333333333" }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
  LEGACY_THREAD_ID: "legacy",
}));
vi.mock("@/lib/equipment-notebooks", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ...domainMock,
}));

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => ["AutomationDirect", "Siemens"]),
  manufacturerFromObservationText: vi.fn(() => null as string | null),
  resolveModelFromObservationText: vi.fn(() => ({ model: null as string | null, ambiguous: false })),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);
// Each test may answer (or fail) one statement the real status read runs; every other query has no rows.
const tenantDb = vi.hoisted(() => ({ answers: [] as { sql: RegExp; answer: () => unknown }[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({
    query: vi.fn(async (sql: string) => {
      const hit = tenantDb.answers.find((a) => a.sql.test(sql));
      return hit ? hit.answer() : { rows: [] };
    }),
  })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));
vi.mock("@/lib/inference/persist-usage", () => ({ persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "t" })) }));
vi.mock("@/lib/workspace-files", () => ({ photoLinkedToTarget: vi.fn(async () => null) }));
vi.mock("@/capabilities/public-model-proof", () => ({ publicManualSeries: vi.fn(async () => null) }));
vi.mock("@/capabilities/part-search-claim", () => ({ claimPartSearchProposal: vi.fn(async () => true) }));
vi.mock("@/lib/manual-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-discovery")>()),
  discoverManual: vi.fn(async () => ({ serviceAvailable: false, found: false, candidate: null, validated: false, isDirectPdf: false, oemHost: false, trustedDistributorHost: false, reason: "off", oemRequestUrl: null })),
}));
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => false),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, r: unknown) => r),
  startManualAcquisition: vi.fn(async () => false),
  currentManualSearchStatus: vi.fn(async () => null as unknown),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async () => ({
  ...(await vi.importActual<typeof import("@/capabilities/notebook-manual-acquisition")>("@/capabilities/notebook-manual-acquisition")),
  ...acqMock,
}));

import { POST } from "../route";

const MANUAL_ASK = "What page of the manual shows the acceleration time for the GS10?";

function chat(body: Record<string, unknown>, headers: Record<string, string> = { "x-mira-manual-wait": "1" }) {
  return POST(new NextRequest(`http://test/api/equipment-notebooks/${NB}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: MANUAL_ASK, sourceDocIds: [DOC_A], threadId: THREAD, clientRequestId: REQUEST_ID, ...body }),
    headers: { "Content-Type": "application/json", ...headers },
  }), { params: Promise.resolve({ id: NB }) });
}

function providerStream(text: string): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  }), { status: 200 });
}

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  return (await res.text()).split("\n\n").map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; } });
}

const status = (extra: Record<string, unknown>) => ({ manufacturer: "AutomationDirect", model: "GS10", startedAt: "2026-11-26T10:00:00.000Z", ...extra });

/** The turn ran to the end and was saved once, and its claim was kept. */
function expectAnsweredAndSaved() {
  expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
  expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
}

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROQ_API_KEY = "k1";
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT, userId: "u1" });
  domainMock.getNotebook.mockResolvedValue(GS10);
  domainMock.validateChatSources.mockImplementation(async (_t: string, _n: string, ids: string[]) =>
    ids.length ? { ok: true, docIds: ids, nodeId: "n1" } : { ok: false, error: "no_sources_selected" });
  domainMock.listTurns.mockResolvedValue([]);
  domainMock.listSources.mockResolvedValue([{ filename: "GS10.pdf", docId: DOC_A }]);
  acqMock.acquisitionEnabled.mockReturnValue(false);
  acqMock.startManualAcquisition.mockResolvedValue(false);
  acqMock.readAcquisition.mockResolvedValue(null);
  acqMock.currentManualSearchStatus.mockResolvedValue(null);
  tenantDb.answers = [];
  vi.stubGlobal("fetch", vi.fn(async () => providerStream("Acceleration time is P01.01.")));
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("a manual question while the project's lookup runs is answered, never held", () => {
  it("running: 200, the turn is saved, and the route reads no lookup status for the send", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({});
    expect(res.status).toBe(200);
    expect((await frames(res)).find((f) => f.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expectAnsweredAndSaved();
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
  });

  it("the header changes nothing: the same request without it streams the same frames", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const withHeader = await frames(await chat({}));
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("Acceleration time is P01.01.")));
    const without = await frames(await chat({}, {}));
    expect(withHeader.map((f) => f.kind)).toEqual(without.map((f) => f.kind));
    expect(withHeader.find((f) => f.kind === "status")).toEqual(without.find((f) => f.kind === "status"));
  });

  it("ready but not in the request: answered with the sources sent", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: false, sourceState: "ready", readySourceDocId: DOC_READY }));
    const res = await chat({});
    expect(res.status).toBe(200);
    await res.text();
    expectAnsweredAndSaved();
  });

  it("the progress transport carries no refusal frame", async () => {
    process.env.MIRA_CHAT_PROGRESS = "1";
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({}, { "x-mira-manual-wait": "1", "x-mira-progress": "1" });
    expect(res.status).toBe(200);
    const all = await frames(res);
    expect(all.some((f) => f.kind === "http_error")).toBe(false);
    expect(all.find((f) => f.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expectAnsweredAndSaved();
  });
});

describe("a send that finds nothing and starts the project's lookup", () => {
  beforeEach(() => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue(null);
    acqMock.startManualAcquisition.mockResolvedValue(true);
    ragMock.retrieveManualChunks.mockResolvedValue([]);
  });

  it("gets main's reply: it is looking, the manual will show up in Sources, ask again", async () => {
    const res = await chat({ mode: "general", sourceDocIds: [] });
    expect(res.status).toBe(200);
    const reply = (await frames(res)).find((f) => f.kind === "status");
    expect(String(reply?.message)).toContain("I'm looking for the official one now. It will show up in this notebook's Sources when I find it; ask again in a minute");
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expectAnsweredAndSaved();
  });
});
