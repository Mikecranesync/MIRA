/**
 * #3959 slice 1 — the attached-miss lane at route level (owner decisions
 * 2026-10-05: "Grounded when attached+hit"; flag wiring "Build it; I add
 * compose lines"). Sources attached, the scoped search matched nothing: with
 * MIRA_PERSONA_CONTRACT on, the turn answers from general knowledge under the
 * attached-miss prompt instead of abstaining. Off, source-only, and the
 * machine-specific decline lanes keep the abstain. Harness: the real notebook
 * chat POST with the same seams as unidentified-service-decline.route.test.ts
 * (the chat route's own __tests__ are a guarded legacy path).
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
import { ATTACHED_MISS_LEAD } from "@/capabilities/mira-contract";

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

describe("#3959 slice 1 — attached sources, nothing matched", () => {
  const packetOf = () => (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
  const unbound = () => ({ id: NB, displayName: "Shop notes", manufacturer: null, model: null });
  const QUESTION = "Why would the conveyor contactor chatter when it pulls in?";

  async function ask(body: Record<string, unknown>, notebook: unknown = unbound()) {
    domainMock.getNotebook.mockResolvedValue(notebook as never);
    const fetchMock = vi.fn(async () => providerStream(`${ATTACHED_MISS_LEAD} Check the coil voltage under load first.`));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A], ...body }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const sent = fetchMock.mock.calls[0] as unknown as [string, { body: string }] | undefined;
    const system = sent ? (JSON.parse(sent[1].body).messages[0].content as string) : null;
    return { fetchMock, status: fr.find((f) => f.kind === "status"), packet: packetOf(), system };
  }

  it("flag on: answers from general knowledge, under the attached-miss prompt, and records it answered", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    const { fetchMock, status, system } = await ask({});
    expect(fetchMock).toHaveBeenCalled();
    expect(status?.status).toBe("answered");
    expect(system).toContain(`Begin the answer with exactly this sentence: "${ATTACHED_MISS_LEAD}"`);
    expect(system).not.toContain("No manual for this machine has been loaded");
  });

  it("control — flag off: the same turn abstains without calling a provider (byte-identical to before)", async () => {
    const { fetchMock, status } = await ask({});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("control — source-only stays strict with the flag on", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    const { fetchMock, status } = await ask({ mode: "source_only" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("control — a general (no-sources) turn keeps main's general prompt", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.validateChatSources.mockResolvedValueOnce({ ok: false, error: "no_sources_selected" } as never);
    const { fetchMock, system } = await ask({ mode: "general", sourceDocIds: [] });
    expect(fetchMock).toHaveBeenCalled();
    expect(system).toContain("No manual for this machine has been loaded");
  });

  const PF525 = { id: NB, displayName: "PF525 — Line 1", manufacturer: "Allen-Bradley", model: "PowerFlex 525" };

  it.each([
    ["a documented value", "What is the default acceleration time on this drive?"],
    ["troubleshooting this machine", "My PowerFlex 525 trips on overcurrent at start, what should I check?"],
  ])("control — #4068: in a machine-bound notebook, %s still abstains with the flag on", async (_label, message) => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    const { fetchMock, status } = await ask({ message }, PF525);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("a teaching question in that machine-bound notebook is answered with the flag on", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    const { fetchMock, status, system } = await ask({ message: "How does a hydraulic accumulator work?" }, PF525);
    expect(fetchMock).toHaveBeenCalled();
    expect(status?.status).toBe("answered");
    expect(system).toContain(ATTACHED_MISS_LEAD);
  });

  it("F3 — when getNotebook fails, the attached-miss lane must not activate", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.getNotebook.mockRejectedValueOnce(new Error("DB unavailable"));
    const { fetchMock, status } = await ask({ message: QUESTION });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("F3 — when getNotebook resolves no notebook, the attached-miss lane must not activate either", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    // An unloaded identity is not "no bound machine": a null read must fail
    // closed exactly like a thrown one.
    domainMock.getNotebook.mockResolvedValueOnce(null as never);
    const { fetchMock, status } = await ask({ message: QUESTION });
    expect(domainMock.getNotebook).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("F1 — the lead plus ordinary diagnostic advice with physical-inspection negations is not a refusal", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.getNotebook.mockResolvedValue(unbound() as never);
    const advice = "A weak coil supply can cause chatter. If you cannot see the armature moving, isolate and lock out the equipment before inspecting it.";
    const fetchMock = vi.fn(async () => providerStream(`${ATTACHED_MISS_LEAD} ${advice}`));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("answered");
  });

  it("F1 — the lead is recognised after leading whitespace too", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.getNotebook.mockResolvedValue(unbound() as never);
    const advice = "A weak coil supply can cause chatter. If you cannot see the armature moving, isolate and lock out the equipment before inspecting it.";
    const fetchMock = vi.fn(async () => providerStream(`\n${ATTACHED_MISS_LEAD} ${advice}`));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(fr.find((f) => f.kind === "status")?.status).toBe("answered");
  });

  it("F1 control — a genuine documents refusal after the lead still trips refusal detection", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.getNotebook.mockResolvedValue(unbound() as never);
    const refusal = "I couldn't find that specification in the documents you selected.";
    const fetchMock = vi.fn(async () => providerStream(`${ATTACHED_MISS_LEAD} ${refusal}`));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: QUESTION, sourceDocIds: [DOC_A] }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
  });

  it("F2 — a grounded zero-source hazard turn searched no documents, so it never claims an attached miss", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    // Codex r1 F2 on #4255. A grounded zero-source turn reaches the gate only
    // when a safety trigger lets it past the no-sources refusal (route: the
    // `!validated.ok && !general && !safetyTrigger` 422). No notebook document
    // was searched, so "Nothing in your attached documents matched" is false.
    domainMock.validateChatSources.mockResolvedValueOnce({ ok: false, error: "no_sources_selected" } as never);
    const { fetchMock, system } = await ask({ message: "Can I check the 480V feeder while energized?", sourceDocIds: [] });
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(system).not.toContain(ATTACHED_MISS_LEAD);
  });

  it("F2 control — a general-mode zero-source photo turn keeps main's general prompt", async () => {
    process.env.MIRA_PERSONA_CONTRACT = "1";
    domainMock.validateChatSources.mockResolvedValueOnce({ ok: false, error: "no_sources_selected" } as never);
    filesMock.photoLinkedToTarget.mockResolvedValueOnce({ fileId: "photo-456", capturedAt: "2026-10-01T10:00:00Z" });
    const { fetchMock, system } = await ask({ mode: "general", sourceDocIds: [], visualEvidence: { fileId: "photo-456" } });
    expect(fetchMock).toHaveBeenCalled();
    expect(system).not.toContain(ATTACHED_MISS_LEAD);
    expect(system).toContain("No manual for this machine has been loaded");
  });
});
