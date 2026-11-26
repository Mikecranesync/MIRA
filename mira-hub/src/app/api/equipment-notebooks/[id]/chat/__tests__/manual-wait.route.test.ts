/**
 * #5746 (option A): the chat route decides whether a question that asks for the project's manual
 * can be answered now. Drives the real handler; the database, the status read and the provider
 * are seams. One case per state, each refusal beside a control that shows the same request is
 * answered without the Hub's opt-in header.
 *
 * Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/chat/__tests__/manual-wait.route.test.ts"
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
  turnsAskedUnderComponent: vi.fn(async () => new Set<string>()),
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
const ORDINARY = "What is the acceleration time for the GS10?";

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

/** Nothing about the refused turn was answered or saved, and its claim was released. */
function expectRefusedCleanly() {
  expect(domainMock.abandonNotebookTurnRequest).toHaveBeenCalledTimes(1);
  expect(domainMock.recordTurn).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
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
  benchStore.turnsAskedUnderComponent.mockImplementation(async () => new Set<string>());
  vi.stubGlobal("fetch", vi.fn(async () => providerStream("Acceleration time is P01.01.")));
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe("the route refuses a manual question it cannot answer yet", () => {
  it("running: 409 manual_not_ready, with the lookup's gate fields only", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true, message: "Looking", manualUrl: "/m" }));
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "manual_not_ready", reason: "running", lookup: status({ running: true }) });
    expectRefusedCleanly();
  });

  it("control: the same request without the header is answered", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({}, {});
    expect(res.status).toBe(200);
    // Main's path: the turn runs and is saved (here the empty retrieval says so honestly).
    expect((await frames(res)).find((f) => f.kind === "status")).toMatchObject({ status: "insufficient_evidence" });
    expect(domainMock.recordTurn).toHaveBeenCalledTimes(1);
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
  });

  it("ready but not in the request: 409 manual_not_ready ready_not_sent, naming the ready source", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: false, sourceState: "ready", readySourceDocId: DOC_READY }));
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_not_ready", reason: "ready_not_sent", lookup: { readySourceDocId: DOC_READY } });
    expectRefusedCleanly();
  });

  it("ready and in the request: answered", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: false, sourceState: "ready", readySourceDocId: DOC_READY }));
    const res = await chat({ sourceDocIds: [DOC_A, DOC_READY] });
    expect(res.status).toBe(200);
    await res.text();
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", "off"],
    ["removed", "removed"],
    ["unavailable", "unavailable"],
  ] as const)("%s: 409 manual_unavailable (%s)", async (sourceState, reason) => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: false, sourceState, message: "m" }));
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_unavailable", reason });
    expectRefusedCleanly();
  });

  // The status read returns nothing for a linked manual that no lookup added (or whose lookup was
  // for another identity) once it is turned off, and, with automatic search switched off, while it
  // is still being prepared or cannot be read. The route reads the project's sources for those.
  const LINKED = { docId: DOC_READY, filename: "GS10.pdf", sourceRole: "manual", matchState: "user_confirmed", matchEvidence: { autoAcquisitionKey: "AUTOMATIONDIRECT|GS10|" } };
  const linked = {
    off: { ...LINKED, enabledByDefault: false, readiness: { state: "chat_ready_basic", canChat: true } },
    preparing: { ...LINKED, enabledByDefault: true, readiness: { state: "stored", canChat: false } },
    unreadable: { ...LINKED, enabledByDefault: true, readiness: { state: "failed", canChat: false } },
  };
  it.each([
    ["turned off", "manual_unavailable", "off", linked.off],
    ["still being prepared", "manual_not_ready", "running", linked.preparing],
    ["unreadable", "manual_unavailable", "unavailable", linked.unreadable],
  ] as const)("a linked manual the status read misses, %s: 409 %s (%s)", async (_name, error, reason, source) => {
    domainMock.listSources.mockResolvedValue([source]);
    const res = await chat({});
    expect(acqMock.currentManualSearchStatus).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error, reason, lookup: { manufacturer: "AutomationDirect", model: "GS10" } });
    expectRefusedCleanly();
  });

  it.each([
    ["without the header", {}, linked.off],
    ["for another model", undefined, { ...linked.off, matchEvidence: { autoAcquisitionKey: "AUTOMATIONDIRECT|GS20|" } }],
  ] as const)("control: a turned-off linked manual %s is answered", async (_name, headers, source) => {
    domainMock.listSources.mockResolvedValue([source]);
    const res = await chat({}, headers);
    expect(res.status).toBe(200);
    await res.text();
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["the status read", () => acqMock.currentManualSearchStatus.mockRejectedValue(new Error("db down"))],
    ["the history read", () => domainMock.listTurns.mockRejectedValue(new Error("db down"))],
  ])("a failed %s pauses: 409 manual_unavailable unknown, never an answer without the manual", async (_name, fail) => {
    fail();
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "manual_unavailable", reason: "unknown", lookup: null });
    expectRefusedCleanly();
  });

  it("no lookup and no manual: answered (main's path)", async () => {
    const res = await chat({});
    expect(res.status).toBe(200);
    await res.text();
    expect(acqMock.currentManualSearchStatus).toHaveBeenCalledTimes(1);
  });

  it("reads this viewer's history of this thread", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    await chat({});
    expect(domainMock.listTurns).toHaveBeenCalledWith(TENANT, NB, 50, { viewerUserId: "u1", threadId: THREAD });
  });

  // A replay of a request that was already answered returns that saved answer, never a refusal: the
  // idempotency key is owned before the manual is consulted.
  it("a replay of an already-saved request returns its saved answer while the lookup runs", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    domainMock.claimNotebookTurnRequest.mockResolvedValueOnce({
      status: "replay",
      turn: {
        id: "turn-saved", question: MANUAL_ASK, answerStatus: "answered", answerText: "Page 42 [1].",
        enabledSourceDocIds: [DOC_A],
        evidence: [{ citationId: "1", docId: DOC_A, sourceTitle: "GS10.pdf", page: 42, fileId: null, quote: "P01.01" }],
        model: "Groq:test", basis: "oem_documentation",
      },
    } as never);
    const res = await chat({});
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Page 42");
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });

  it("the progress transport carries the same refusal in its http_error frame", async () => {
    process.env.MIRA_CHAT_PROGRESS = "1";
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({}, { "x-mira-manual-wait": "1", "x-mira-progress": "1" });
    expect(res.status).toBe(200);
    expect(await frames(res)).toContainEqual({ kind: "http_error", status: 409, body: { error: "manual_not_ready", reason: "running", lookup: status({ running: true }) } });
    expectRefusedCleanly();
  });
});

describe("questions that mention the manual without an article wait (r8 F11)", () => {
  it.each([
    "Which manual covers the acceleration time for the GS10?",
    "Do you have manuals for the GS10?",
    // A safety word that is not a safety, energized-work or bypass stop does not exempt it.
    "What does the manual say about the bypass contactor on the GS10?",
  ])("%s: 409 while the lookup runs", async (message) => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({ message });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_not_ready", reason: "running" });
    expectRefusedCleanly();
  });

  it("control: the machine's manual mode is not a manual ask, and is answered", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({ message: "How do I switch the GS10 to manual mode?" });
    expect(res.status).toBe(200);
    await res.text();
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
  });
});

// r8 F12/F13: the wait reads the project's status in its own mode, through the real status read.
// A failed read of the lookup's record pauses the question, and an earlier answer from a document
// does not settle a failed lookup into "nothing to wait for". The notebook detail read keeps both.
describe("the wait's status read fails closed (r8 F12, F13)", () => {
  const GS10_KEY = "AUTOMATIONDIRECT|GS10|";
  const FAILED = {
    key: GS10_KEY, state: "download_rejected", started_at: "2026-11-26T10:00:00.000Z", finished_at: null,
    candidate_host: "www.automationdirect.com", match_state: null, oem_request_url: null,
    candidate_url: "https://www.automationdirect.com/gs10.pdf", download_reason: "wrong_content_type",
  };
  const COMPLETE = { key: GS10_KEY, state: "complete", started_at: "2026-11-26T10:00:00.000Z", finished_at: null, doc_id: DOC_READY, candidate_host: null, match_state: null, oem_request_url: null };
  const RECORD_READ = /SELECT manual_acquisition FROM equipment_notebooks/;
  const GROUNDED = { id: "t0", question: "What is P09.03 on the GS10?", evidence: [], answerStatus: "answered", basis: "oem_documentation" };
  const record = (rec: unknown) => ({ sql: RECORD_READ, answer: () => ({ rows: [{ manual_acquisition: rec }] }) });
  const fails = (sql: RegExp, code?: string) => ({ sql, answer: () => { throw Object.assign(new Error("connection reset"), code ? { code } : {}); } });

  beforeEach(async () => {
    const real = await vi.importActual<typeof import("@/capabilities/notebook-manual-acquisition")>("@/capabilities/notebook-manual-acquisition");
    acqMock.currentManualSearchStatus.mockImplementation(real.currentManualSearchStatus as never);
  });

  it("a failed read of the lookup's record pauses: 409 manual_unavailable unknown", async () => {
    tenantDb.answers = [fails(RECORD_READ)];
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "manual_unavailable", reason: "unknown", lookup: null });
    expectRefusedCleanly();
  });

  it("a failed check of a finished lookup against the Sources pauses too: 409 unknown", async () => {
    tenantDb.answers = [record(COMPLETE), fails(/FROM equipment_notebook_sources/)];
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "manual_unavailable", reason: "unknown", lookup: null });
    expectRefusedCleanly();
  });

  it.each([
    ["no lookup recorded", () => ({ sql: RECORD_READ, answer: () => ({ rows: [] }) })],
    ["the column before migration 100", () => fails(RECORD_READ, "42703")],
  ])("control: %s is answered (nothing to wait for)", async (_name, answer) => {
    tenantDb.answers = [answer()];
    const res = await chat({});
    expect(res.status).toBe(200);
    await res.text();
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });

  it("an earlier answer from a document does not hide a failed lookup: 409 manual_unavailable", async () => {
    tenantDb.answers = [record(FAILED)];
    domainMock.listTurns.mockResolvedValue([GROUNDED]);
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_unavailable", reason: "unavailable", lookup: { model: "GS10", running: false, sourceState: "unavailable" } });
    expectRefusedCleanly();
  });

  it("control: the same failed lookup with no earlier answer pauses the same way", async () => {
    tenantDb.answers = [record(FAILED)];
    const res = await chat({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_unavailable", reason: "unavailable" });
  });
});

describe("the outgoing question's subject decides (r7 F10)", () => {
  it("a question that names another exact model is answered while the project's lookup runs", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({ message: "What page of the manual shows the acceleration time for the PowerFlex 525?" });
    expect(res.status).toBe(200);
    await res.text();
  });

  it("a status whose machine can't be named is the project's machine: 409 (never answered without it)", async () => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true, model: "" }));
    domainMock.getNotebook.mockResolvedValue({ ...GS10, model: null });
    const res = await chat({ message: "What page of the manual shows the acceleration time?" });
    expect(res.status).toBe(409);
    expectRefusedCleanly();
  });

  it("control: after a look-alike question, a question that names the project's model waits", async () => {
    domainMock.listTurns.mockResolvedValue([{ id: "t1", question: "What does the manual say about the PowerFlex 525?", evidence: [], answerStatus: "answered", basis: null }]);
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat({});
    expect(res.status).toBe(409);
  });
});

describe("questions and turns that keep their own path never read the manual's status", () => {
  it.each([
    ["an ordinary question", { message: ORDINARY }],
    ["a safety report", { message: "Smoke is coming out of the drive, what does the manual say?" }],
    // The route's own stops decide these (r8 F11): the energized-work stop, the safety stop (a
    // lockout ask, and the energized-hazard directive), and the bypass stop.
    ["an energized-work ask", { message: "How do I swap the fan on the GS10 while it's powered? What does the manual say?" }],
    ["a lockout ask", { message: "How do I lock out the GS10 before opening it, per the manual?" }],
    ["an energized-hazard ask", { message: "Can I measure the DC bus on the GS10 while it's live, per the manual?" }],
    ["a bypass ask", { message: "The manual says to bypass the guard on the GS10, is that safe?" }],
    ["an interlock bypass ask", { message: "Can I jumper out the safety interlock on the GS10? What does the manual say?" }],
    ["a photo", { visualEvidence: { fileId: PHOTO, capturedAt: "2026-11-26T10:00:00.000Z" } }],
    ["the guided dead end", { mode: "general", sourceDocIds: [], guidedEscalation: { sessionId: "88888888-8888-4888-8888-888888888888" } }],
  ])("%s", async (_name, body) => {
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    const res = await chat(body);
    expect(res.status).not.toBe(409);
    await res.text();
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
  });

  // A question asked under a selected component is about that component (#5750), so the project's
  // manual never holds it. The component is held here (not confirmed), which reads no manual.
  it("a manual question asked under a selected component", async () => {
    const COMPONENT = "99999999-9999-4999-8999-999999999999";
    acqMock.currentManualSearchStatus.mockResolvedValue(status({ running: true }));
    chatTurn.resolveComponentTurn.mockResolvedValueOnce({
      kind: "hold", reason: "not_confirmed", revision: 1, text: "Confirm the component first.", actions: [],
      component: { id: COMPONENT, position: 0, kind: "drive", current: null },
      selection: { componentId: COMPONENT, version: 3 },
    } as never);
    const res = await chat({ componentSelection: { threadId: THREAD, componentId: COMPONENT, selectionVersion: 3 } });
    expect(res.status).toBe(200);
    await res.text();
    expect(chatTurn.resolveComponentTurn).toHaveBeenCalledTimes(1);
    expect(acqMock.currentManualSearchStatus).not.toHaveBeenCalled();
    expect(domainMock.abandonNotebookTurnRequest).not.toHaveBeenCalled();
  });
});

describe("a send that finds nothing and starts the project's lookup waits for it", () => {
  beforeEach(() => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue(null);
    acqMock.startManualAcquisition.mockResolvedValue(true);
    ragMock.retrieveManualChunks.mockResolvedValue([]);
  });

  it("409 manual_not_ready running: the lookup keeps running, and nothing about the turn is saved", async () => {
    const res = await chat({ mode: "general", sourceDocIds: [] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "manual_not_ready", reason: "running", lookup: { manufacturer: "AutomationDirect", model: "GS10", running: true } });
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expectRefusedCleanly();
  });

  it("control: without the header the turn says it is looking, as main does", async () => {
    const res = await chat({ mode: "general", sourceDocIds: [] }, {});
    expect(res.status).toBe(200);
    const status = (await frames(res)).find((f) => f.kind === "status");
    expect(String(status?.message)).toContain("looking for the official one now");
  });
});
