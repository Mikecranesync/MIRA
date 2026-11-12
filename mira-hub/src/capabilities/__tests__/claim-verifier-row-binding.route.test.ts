/**
 * Garage pilot PR-4, route level: the shadow claim verifier is handed the record
 * number RETRIEVAL scoped by — the post-suspension `diagnostics.recordNumber` —
 * never the raw confirmed catalog number. (Until Mike's 2026-11-12 ruling a
 * sibling question — "the GS13N-20P2?" — suspended the record and kept the
 * sibling's column; retrieval now refuses it, manual-rag.ts siblingOfRecordAsk.
 * The mocked-retrieval case below still pins the verifier's own contract: a
 * turn served with `recordNumber: null` is judged without the record, never
 * flagged against it.) Same seams as
 * citation-source-url.route.test.ts; span attributes read from the real tracer.
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
  listTurns: vi.fn(async () => [] as unknown[]),
  normalizeNotebookThreadId: (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null),
  recordTurn: vi.fn(async () => "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  getNotebook: vi.fn(async () => ({
    id: NB,
    displayName: "GS10 — garage conveyor",
    manufacturer: "AutomationDirect",
    model: "GS10",
    catalogNumber: "GS11N-20P2",
    identityStatus: "user_confirmed",
  })),
  listSources: vi.fn(async () => [{ filename: "gs10usermanual.pdf", docId: DOC_A }]),
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
  resolveModelFromObservationText: vi.fn(() => ({ model: null, ambiguous: false })),
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

function providerStream(text: string): Response {
  const chunks = [
    ...text.split(" ").map((w) => `data: ${JSON.stringify({ id: "resp-1", choices: [{ delta: { content: w + " " } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
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
  process.env.NOTEBOOK_CLAIM_VERIFIER = "shadow";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  domainMock.recordTurn.mockResolvedValue(ROW_ID);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
});

// table-rows.ts's real output on the GS10 p.26 / p.27 item dumps, abbreviated: one chunk per model.
const OWN = {
  content:
    "230V Class – 1-Phase Model-Specific Specifications — Model Name: GS11N-2xPx — GS11N-20P2\n" +
    "GS11N-20P2: CT Rated Input Current 5.1 A\nGS11N-20P2: VT Rated Input Current 5.8 A",
  docId: DOC_A, sourceUrl: "hub-upload://t/gs10usermanual.pdf", sourcePage: 26, title: "GS10 User Manual",
  manufacturer: "AutomationDirect", modelNumber: "GS10", rank: 1, verified: true, tableModels: ["GS11N20P2"],
};
const LOOKALIKE = {
  ...OWN,
  content:
    "230V Class – 3-Phase Model-Specific Specifications — Model Name: GS13N-2xPx — GS13N-20P2\n" +
    "GS13N-20P2: CT Rated Input Current 1.9 A\nGS13N-20P2: VT Rated Input Current 2.2 A",
  sourcePage: 27, tableModels: ["GS13N20P2"],
};

/** Retrieval's seam: it returns `chunks` and reports the record number it scoped by. */
function retrievalReports(recordNumber: string | null, chunks: unknown[]) {
  ragMock.retrieveNodeChunks.mockImplementation((async (...args: unknown[]) => {
    const opts = args[3] as { diagnostics?: { recordNumber?: string | null } };
    if (opts.diagnostics) opts.diagnostics.recordNumber = recordNumber;
    return chunks;
  }) as never);
}

async function gateAttrs(message: string, answer: string): Promise<Record<string, unknown>> {
  vi.stubGlobal("fetch", vi.fn(async () => providerStream(answer)));
  await (await POST(chatReq({ message, sourceDocIds: [DOC_A] }), params)).text();
  await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
  const gate = handle.finished().filter((s) => s.name === "answer_gate.evaluate").at(-1);
  expect(gate).toBeDefined();
  return gate!.attributes as Record<string, unknown>;
}

describe("garage pilot PR-4: the chat route hands the shadow verifier retrieval's record number", () => {
  it("retrieval scoped by the record: the record's own 5.1 A is bound by its row (row_bound = 1)", async () => {
    retrievalReports("GS11N-20P2", [OWN]);
    const attrs = await gateAttrs("What is its CT rated input current?", "It is 5.1 A [1].");
    expect(attrs["mira.claim_verifier.verdict"]).toBe("supported");
    expect(attrs["mira.claim_verifier.row_bound"]).toBe(1);
  });

  it("retrieval suspended the record (the question named a sibling): the sibling's 1.9 A is judged without it — supported, not a false flag", async () => {
    // The notebook's confirmed number is still GS11N-20P2; passing it raw would put
    // 1.9 A on "another model's line" and flag a correct answer.
    retrievalReports(null, [LOOKALIKE]);
    const attrs = await gateAttrs("What is the rated input current of the GS13N-20P2?", "It is 1.9 A [1].");
    expect(attrs["mira.claim_verifier.verdict"]).toBe("supported");
    expect(attrs["mira.claim_verifier.row_bound"]).toBe(0);
  });
});

/** The persisted turn record's answer_gate.claim_verifier — what the harness reads back per turn. */
function persistedClaimVerifier(): unknown {
  const call = persistMock.persistTurnUsage.mock.calls[0] as unknown[];
  const record = call[2] as { packet: { answer_gate: Record<string, unknown> } };
  return record.packet.answer_gate.claim_verifier;
}

describe("garage pilot PR-4f: the shadow verdict is kept on the persisted turn record (the per-build flag rate's source)", () => {
  it("shadow on: answer_gate.claim_verifier carries the verdict, counts and per-claim statuses — never a value", async () => {
    retrievalReports("GS11N-20P2", [OWN]);
    await gateAttrs("What is its CT rated input current?", "It is 5.1 A [1].");
    const cv = persistedClaimVerifier();
    expect(cv).toEqual({
      verdict: "supported",
      reason: "all_bound",
      claim_count: 1,
      row_bound: 1,
      unbound: 0,
      absent: 0,
      claims: [{ kind: "quantity", status: "supported", page: 26, via: "row" }],
    });
    expect(JSON.stringify(cv)).not.toContain("5.1");
  });

  it("shadow off: the field is absent (not run), so the harness never reads an absent verdict as supported", async () => {
    delete process.env.NOTEBOOK_CLAIM_VERIFIER;
    retrievalReports("GS11N-20P2", [OWN]);
    await gateAttrs("What is its CT rated input current?", "It is 5.1 A [1].");
    expect(persistedClaimVerifier()).toBeUndefined();
  });
});
