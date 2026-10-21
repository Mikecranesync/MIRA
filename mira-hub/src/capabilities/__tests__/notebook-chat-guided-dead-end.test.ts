// WP-1 guided dead end (owner decision 2026-10-21) — a narrow exception to #4068. A general-mode turn
// on an identity-bound notebook with nothing citable still declines ("won't guess") UNLESS it names
// a guided session the server confirms is this notebook's latest and ended at a manual dead end.
// Then it answers from general knowledge, labelled general. Harness copied from
// chat-flight-recorder.test.ts (that file is under the guarded src/app tree).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SESSION = "55555555-5555-4555-8555-555555555555";

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

// The guided dead-end check is the only guided_procedure_sessions read; every other tenant-scoped
// read returns no rows. `deadEnd` decides what the check finds.
const tc = vi.hoisted(() => ({ deadEnd: false, sql: [] as { sql: string; params: unknown[] }[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes("guided_procedure_sessions")) {
          tc.sql.push({ sql, params });
          return { rows: tc.deadEnd ? [{ "?column?": 1 }] : [] };
        }
        return { rows: [] };
      }),
    })),
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

const manualDiscoveryMock = vi.hoisted(() => ({ discoverManual: vi.fn() }));
// #4171 F3 — the one-time proposal claim is a DB write; claimed by default.
const claimMock = vi.hoisted(() => ({ claimPartSearchProposal: vi.fn(async () => true) }));
vi.mock("@/capabilities/part-search-claim", () => claimMock);

// Only the network call is a seam; the pure helpers (e.g. the shared OEM maker
// table the R1 candidate extractor reads) stay real.
vi.mock("@/lib/manual-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-discovery")>()),
  ...manualDiscoveryMock,
}));

// #4075 — the automatic manual search. The pure helpers (key, decline text) are
// the real ones; only the flag, the notebook read and the background start are
// seams. Off by default so every other test in this file is unaffected.
const acqMock = vi.hoisted(() => ({
  acquisitionEnabled: vi.fn(() => false),
  // #4175: the candidate takeover flag follows the base flag in this file
  // unless a test pins it (so "acquisition on" tests exercise S6 behaviour).
  candidateAcquisitionEnabled: vi.fn((): boolean => acqMock.acquisitionEnabled()),
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

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    });
}

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


const SMC = { id: NB, displayName: "SMC Flex line 2", manufacturer: "Allen-Bradley", model: "SMC Flex" };
const DEAD_END_Q =
  "I followed the manufacturer's troubleshooting for this machine (150-UM008J-EN-P). The manual does not document what to do next for this case. " +
  "What I checked: Table 48 - Miscellaneous Situations (p.106): None of the documented options. What else could cause this, and what should I check?\n" +
  "What I'm seeing: no fault displayed; the bypass contactor drops out and pulls back in every few seconds";

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  tc.deadEnd = false;
  tc.sql.length = 0;
  acqMock.acquisitionEnabled.mockReturnValue(false);
  acqMock.candidateAcquisitionEnabled.mockImplementation(() => acqMock.acquisitionEnabled());
  process.env.GROQ_API_KEY = "k1";
  process.env.MIRA_CANONICAL_SEAM = "1";
  process.env.NOTEBOOK_ANSWER_GATE = "0";
  process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
  process.env.NOTEBOOK_GUIDED_PROCEDURE = "1";
  sessionMock.sessionOr401.mockResolvedValue({ tenantId: TENANT_A, userId: "u1" } as never);
  domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_A], nodeId: "n1" } as never);
  domainMock.recordTurn.mockResolvedValue(ROW_ID);
  domainMock.getNotebook.mockResolvedValue(SMC as never);
  ragMock.retrieveNodeChunks.mockResolvedValue([] as never);
  ragMock.retrieveManualChunks.mockResolvedValue([] as never);
  manualDiscoveryMock.discoverManual.mockResolvedValue({
    serviceAvailable: false, found: false, candidate: null, validated: false, isDirectPdf: false,
    oemHost: false, trustedDistributorHost: false, reason: "search service unavailable", oemRequestUrl: null,
  });
  fetchMock = vi.fn(async () => providerStream("General guidance beyond your manual: check the bypass contactor coil supply first."));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
});

const ask = (extra: Record<string, unknown> = {}) =>
  POST(chatReq({ message: DEAD_END_Q, mode: "general", sourceDocIds: [], ...extra }), params);
const systemPromptOf = () => {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  const msgs = (JSON.parse(String(init?.body ?? "{}")).messages ?? []) as { role: string; content: string }[];
  return msgs.find((m) => m.role === "system")?.content ?? "";
};

describe("guided dead end — the narrow exception to #4068", () => {
  it("control: the same question with no guided session still declines (#4068 holds), no provider call", async () => {
    const fr = await frames(await ask());
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("won't guess");
    expect(tc.sql).toHaveLength(0);
  });

  it("a confirmed dead end answers from general knowledge, labelled general, with the dead-end directive", async () => {
    tc.deadEnd = true;
    const fr = await frames(await ask({ guidedEscalation: { sessionId: SESSION } }));
    expect(fetchMock).toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.status).toBe("answered");
    expect(fr.find((f) => f.kind === "evidence")?.basis).toBe("general_reasoning");
    expect(fr.some((f) => f.kind === "sources" && Array.isArray(f.citations) && (f.citations as unknown[]).length > 0)).toBe(false);
    expect(systemPromptOf()).toContain("GUIDED PROCEDURE DEAD END");
    // The check is bound to this caller's tenant, this notebook and the named session.
    expect(tc.sql).toHaveLength(1);
    expect(tc.sql[0].params).toEqual([TENANT_A, NB, SESSION]);
    expect(tc.sql[0].sql).toContain("status = 'degraded'");
  });

  it("a named session the server does not confirm (not a dead end, other tenant, superseded) still declines", async () => {
    tc.deadEnd = false;
    const fr = await frames(await ask({ guidedEscalation: { sessionId: SESSION } }));
    expect(tc.sql).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.status).toBe("insufficient_evidence");
  });

  it("with the guided feature switched off the claim is never even checked", async () => {
    delete process.env.NOTEBOOK_GUIDED_PROCEDURE;
    tc.deadEnd = true;
    const fr = await frames(await ask({ guidedEscalation: { sessionId: SESSION } }));
    expect(tc.sql).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.status).toBe("insufficient_evidence");
  });

  it("a malformed session id is ignored, not queried", async () => {
    tc.deadEnd = true;
    await frames(await ask({ guidedEscalation: { sessionId: "1 OR 1=1" } }));
    expect(tc.sql).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an ordinary general-mode answer never carries the dead-end directive", async () => {
    domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unknown box", manufacturer: null, model: null } as never);
    await frames(await POST(chatReq({ message: "how does a soft starter bypass contactor work", mode: "general", sourceDocIds: [] }), params));
    expect(fetchMock).toHaveBeenCalled();
    expect(systemPromptOf()).not.toContain("GUIDED PROCEDURE DEAD END");
  });
});
