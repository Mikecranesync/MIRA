/**
 * #4128 — a credential or firmware-recovery question about THIS equipment in a
 * chat that identifies no equipment gets an honest decline, never a generic
 * recovery walkthrough (#4101 service-only: 3/3 Pixel attempts failed by both
 * graders on staging cc71d1e61). Route-level: the real notebook chat POST with
 * the same seams as chat-flight-recorder.test.ts (a guarded legacy path, so the
 * new cases live here).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { __testing__installInMemoryExporter } from "@/capabilities/observability/tracing";
import type { TurnRecord } from "@/lib/inference/persist-usage";

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

describe("#4128 unidentified equipment + credential / firmware recovery → honest decline", () => {
  const packetOf = () => (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
  const unbound = () => ({ id: NB, displayName: "General", manufacturer: null, model: null });
  const SERVICE_ONLY = "How do I recover this actuator firmware by USB, and what is its service password?";

  async function ask(message: string) {
    domainMock.getNotebook.mockResolvedValue(unbound() as never);
    const fetchMock = vi.fn(async () => providerStream("General steps: hold the boot button and re-apply power."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message, mode: "general" }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    return { fr, fetchMock, status: fr.find((f) => f.kind === "status"), packet: packetOf() };
  }

  it("the #4101 service-only question declines both halves and never calls the provider", async () => {
    const { fetchMock, status, packet } = await ask(SERVICE_ONLY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
    const msg = String(status?.message);
    expect(msg).toContain("won't give generic steps");
    expect(msg).toContain("make and model");
    expect(msg).toContain("equipment owner or the manufacturer's service line");
    expect(msg).not.toMatch(/boot button|re-apply power/i);
    expect(packet.answer_gate.reason).toBe("unidentified_service_decline");
  });

  it.each([
    ["credential only", "what's the service password for this drive?", "service line", "make and model"],
    ["firmware only", "My actuator firmware is corrupted. How do I recover it?", "make and model", "service line"],
  ])("%s gets only its own half", async (_label, message, present, absent) => {
    const { fetchMock, status } = await ask(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(status?.message)).toContain(present);
    expect(String(status?.message)).not.toContain(absent);
  });

  it.each([
    "What is firmware recovery?",
    "how does a VFD work in general",
    "What does a service password protect on a drive?",
  ])("control — a teaching question keeps the general lane: %s", async (message) => {
    const { fetchMock, status, packet } = await ask(message);
    expect(fetchMock).toHaveBeenCalled();
    expect(status?.status).toBe("answered");
    expect(packet.answer_gate.reason).not.toBe("unidentified_service_decline");
  });

  it("control — a bound notebook keeps the #4094 machine-named copy, not this one", async () => {
    domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Hoist", manufacturer: "Demag", model: "DC-Pro" } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "what is the service passcode for this hoist", mode: "general" }), params));
    const status = fr.find((f) => f.kind === "status");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(status?.message)).toContain("Demag service");
    expect(String(status?.message)).not.toContain("manufacturer's service line");
  });

  it("control — a flagged hazard turn is never swallowed by the decline", async () => {
    const { fetchMock, packet } = await ask("How do I recover this drive firmware while energized on the 480v feeder?");
    expect(fetchMock).toHaveBeenCalled();
    expect(packet.answer_gate.reason).not.toBe("unidentified_service_decline");
  });
});
