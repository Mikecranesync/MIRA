/**
 * On a turn with no selected document, any passages come from the shared
 * library. That search is asked for the project's own maker and model, or for
 * a stored photo's when those are blank. It is not asked for the confirmed
 * bound machine. So the machine header of such a turn must not name the bound
 * machine's model over those passages (Codex round 2 on #5412, F2, and the
 * photo case found beside it).
 *
 * These rows are the ones the catalog-number test file cannot hold: its
 * shared library returns nothing. Here the search is a stand-in that DOES
 * return a passage, so each row reads three things from the real chat route:
 * what the library was asked for, that its passage was served as a citation,
 * and the Equipment line the provider was handed. Whether the real search
 * would admit such a passage is not exercised here.
 *
 * Seams as citation-source-url.route.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { __testing__installInMemoryExporter } from "@/capabilities/observability/tracing";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

const domainMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  claimNotebookTurnRequest: vi.fn(async () => ({
    status: "claimed" as const,
    claimToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  })),
  abandonNotebookTurnRequest: vi.fn(async () => undefined),
  // Now returns the row id (equipment-notebooks.ts fix, this lane) — the
  // packet's `persistence.turn_row_id` / `ids.turn_id` depend on it.
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
  recordTurn: vi.fn(async () => "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  getNotebook: vi.fn(async () => ({
    id: NB,
    displayName: "PF525 — Line 1",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
  })),
  listSources: vi.fn(async () => [{ filename: "PF525.pdf", docId: DOC_A }]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => domainMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  retrieveManualChunks: vi.fn(async () => [] as unknown[]),
  corpusManufacturers: vi.fn(async () => ["Siemens", "Allen-Bradley", "Automation Direct"]),
  manufacturerFromObservationText: vi.fn((text: string, names: readonly string[]) =>
    names.find((n) => text.toLowerCase().includes(n.toLowerCase())) ?? null,
  ),
  // The route is tested with a deterministic identity seam; the real parser's
  // conflict and alias behavior is covered in manual-rag.test.ts.
  resolveModelFromObservationText: vi.fn((text: string) => {
    const tp = text.match(/\bTP\s*\d{3,4}\b/i)?.[0].replace(/\s+/g, "").toUpperCase() ?? null;
    const v20 = /\b(?:SINAMICS\s*)?V\s*20\b/i.test(text) ? "V20" : null;
    if (tp && v20) return { model: null, ambiguous: true };
    return { model: tp ?? v20, ambiguous: false };
  }),
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    // Raw-pool client for the OEM corpus path (hybrid corpus law).
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));

const persistMock = vi.hoisted(() => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "trace-1" })),
}));
vi.mock("@/lib/inference/persist-usage", () => persistMock);

const filesMock = vi.hoisted(() => ({
  photoLinkedToTarget: vi.fn(async (): Promise<{ fileId: string; capturedAt: string } | null> => null),
}));
vi.mock("@/lib/workspace-files", () => filesMock);

const veMock = vi.hoisted(() => ({
  blockingLookHazard: vi.fn(() => null),
  loadVisualEvidenceForAsset: vi.fn(async () => [] as unknown[]),
  renderVisualEvidenceSection: vi.fn(() => ""),
  loadVisualEvidenceForPhoto: vi.fn(async () => null as unknown),
  loadRecentLookObservations: vi.fn(async () => []),
  renderLookObservationSection: vi.fn((row: unknown) => (row ? "## LOOK-CTX" : "")),
  renderPriorLookObservationsSection: vi.fn((rows: unknown[]) => (rows && rows.length ? "## PRIOR-LOOK-CTX" : "")),
  normalizeLookHazards: vi.fn(() => []),
  recordLookObservation: vi.fn(async () => ({})),
}));
vi.mock("@/lib/visual-evidence-context", () => veMock);

// #4075 — the automatic manual search. The pure helpers (key, decline text) are
// the real ones; only the flag, the notebook read and the background start are
// seams. Off by default so every other test in this file is unaffected.
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => false),
  readAcquisition: vi.fn(async () => null as unknown),
  reconcileAcquisition: vi.fn(async (_t: string, _n: string, r: unknown) => r),
  startManualAcquisition: vi.fn(async () => false),
}));
vi.mock("@/capabilities/notebook-manual-acquisition", async () => {
  const actual = await vi.importActual<typeof import("@/capabilities/notebook-manual-acquisition")>(
    "@/capabilities/notebook-manual-acquisition",
  );
  return { ...actual, ...acqMock };
});

import { POST } from "@/app/api/equipment-notebooks/[id]/chat/route";

const chatReq = (body: unknown) =>
  new NextRequest("http://test/api/equipment-notebooks/nb/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: NB }) };


/** A provider SSE stream: deltas, then the include_usage final chunk. */
function providerStream(text: string, usage?: Record<string, unknown>): Response {
  const chunks = [
    ...text.split(" ").map((w) => `data: ${JSON.stringify({ id: "resp-1", choices: [{ delta: { content: w + " " } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], ...(usage ? { usage } : {}) })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  handle.reset();
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  domainMock.recordTurn.mockResolvedValue(ROW_ID);
  ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
});




const MACHINE = "44444444-4444-4444-8444-444444444444";
const boundDrive = {
  state: "resolved",
  entityId: MACHINE,
  name: "CV-101 bench drive",
  unsPath: "enterprise.garage.cv_101.drive",
  selectedVia: "asset_picker",
  confirmedAt: "2026-11-10T07:40:00.000Z",
  manufacturer: "AutomationDirect",
  model: "GS11N-20P2",
};
const ASSET = " Asset: CV-101 bench drive — canonical path enterprise.garage.cv_101.drive. Identity CONFIRMED by a technician.";

type Hit = { manufacturer: string; modelNumber: string; title: string };

/** Ask with no document selected, as both apps do; return what the route did. */
async function askWithNoDocument(project: Record<string, unknown>, photo: string | null, hit: Hit) {
  domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Bench drive", catalogNumber: null, identityStatus: "candidate", ...project } as never);
  domainMock.listSources.mockResolvedValue([] as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [], nodeId: "n1" } as never);
  domainMock.resolveBoundAsset.mockResolvedValue(boundDrive as never);
  veMock.loadRecentLookObservations.mockResolvedValue(
    (photo ? [{ fileId: "55555555-5555-4555-8555-555555555555", text: photo, observedAt: "2026-11-10T14:00:00Z" }] : []) as never,
  );
  ragMock.retrieveManualChunks.mockResolvedValue([
    { content: "Input: 380-480V AC three-phase.", docId: null, ...hit, sourceUrl: "https://test.invalid/manual.pdf", sourcePage: 12, rank: 1 },
  ] as never);
  const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => providerStream("See [1]."));
  vi.stubGlobal("fetch", fetchMock);
  const served = await (await POST(chatReq({ message: "What supply voltage does it need?", mode: "general" }), params)).text();
  const searchedFor = ragMock.retrieveManualChunks.mock.calls.map((c) => {
    const o = (c as unknown[])[3] as { manufacturer?: string; model?: string | null };
    return `${o.manufacturer} / ${o.model}`;
  });
  expect(fetchMock.mock.calls.length, `the provider was asked; the route served: ${served.slice(0, 400)}`).toBeGreaterThan(0);
  const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}")) as { messages?: { role: string; content: string }[] };
  const system = String(sent.messages?.find((m) => m.role === "system")?.content ?? "");
  return { searchedFor, served, system };
}

describe("a turn with no selected document: the header names what the shared library was searched for", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a project whose own maker and model nobody confirmed, tied to a confirmed machine of another model", async () => {
    const { searchedFor, served, system } = await askWithNoDocument(
      { manufacturer: "Allen-Bradley", model: "PowerFlex 525" },
      null,
      { manufacturer: "Allen-Bradley", modelNumber: "PowerFlex 525", title: "PowerFlex 525 User Manual" },
    );
    expect(searchedFor).toEqual(["Allen-Bradley / PowerFlex 525"]);
    expect(served).toContain("PowerFlex 525 User Manual");
    expect(system).toContain(`- Equipment: Allen-Bradley PowerFlex 525 — "Bench drive".${ASSET}\n- Loaded source documents: none.\n`);
    expect(system).not.toContain("GS11N-20P2");
    expect(system).not.toMatch(/Catalog number/);
  });

  it("a project with no maker or model of its own, tied to a confirmed machine, with a stored photo of another maker's drive", async () => {
    const { searchedFor, served, system } = await askWithNoDocument(
      { manufacturer: null, model: null },
      "SIEMENS SINAMICS V20 drive nameplate, 3AC 380-480V",
      { manufacturer: "Siemens", modelNumber: "V20", title: "SINAMICS V20 Operating Instructions" },
    );
    expect(searchedFor).toEqual(["Siemens / V20"]);
    expect(served).toContain("SINAMICS V20 Operating Instructions");
    expect(system).toContain(`- Equipment: an unspecified machine — "Bench drive".${ASSET}\n- Loaded source documents: none.\n`);
    expect(system).not.toContain("GS11N-20P2");
    expect(system).not.toMatch(/Catalog number/);
  });
});
