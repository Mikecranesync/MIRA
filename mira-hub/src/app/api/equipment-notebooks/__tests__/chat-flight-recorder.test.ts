/**
 * Turn Flight Recorder — route wiring (lane I2).
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * Drives the REAL notebook-chat handler with a real `NodeTracerProvider`
 * (`__testing__installInMemoryExporter()`, tracing.ts, lane I1) so span
 * parentage, trace-id propagation across the deferred persistence tail, and
 * the packet handed to `persistTurnUsage` can all be asserted on real output
 * — not mocked away.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/chat-flight-recorder.test.ts
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { turnOnlySampler } from "@/capabilities/observability/turn-sampler";
import { __testing__installInMemoryExporter } from "@/capabilities/observability/tracing";
import type { TurnRecord } from "@/lib/inference/persist-usage";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_A = "33333333-3333-4333-8333-333333333333";
const PHOTO = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
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

const manualDiscoveryMock = vi.hoisted(() => ({ discoverManual: vi.fn() }));
vi.mock("@/lib/manual-discovery", () => manualDiscoveryMock);

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

import { POST } from "../[id]/chat/route";
import { withTenantContext } from "@/lib/tenant-context";

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

function firstRecordedPacket() {
  return (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
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
  manualDiscoveryMock.discoverManual.mockResolvedValue({
    serviceAvailable: false,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason: "search service unavailable",
    oemRequestUrl: null,
  });
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.env = { ...ENV };
});

describe("mira.turn span tree + trace propagation", () => {
  it("an answered general-mode turn produces one trace shared by every child, including the persistence tail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance here.", { prompt_tokens: 3, completion_tokens: 2 })));
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));

    const spans = handle.finished();
    const root = spans.find((s) => s.name === "mira.turn");
    expect(root).toBeTruthy();
    const traceId = root!.spanContext().traceId;
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    const names = spans.map((s) => s.name);
    for (const expected of ["evidence.materialize", "identity.resolve", "retrieval.execute", "context.assemble", "answer_gate.evaluate", "turn.persist"]) {
      expect(names).toContain(expected);
    }
    expect(names.some((n) => n.startsWith("chat "))).toBe(true);

    // Every span in this turn shares the root's trace id.
    for (const s of spans) expect(s.spanContext().traceId).toBe(traceId);

    // The deferred persistence tail (setTimeout(0) after controller.close())
    // still used the SAME trace id — proving the recorder threads it through
    // explicitly rather than depending on ambient context at that point.
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.otelTraceId).toBe(traceId);
    expect(record.packet.answer_gate.decision).toBe("answered");
    expect(record.packet.kind).toBe("chat");
  });

  it("the first SSE frame is kind 'trace' and the response carries x-mira-trace-id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance here.")));
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    const headerTraceId = res.headers.get("x-mira-trace-id");
    expect(headerTraceId).toMatch(/^[0-9a-f]{32}$/);
    const f = await frames(res);
    expect(f[0]).toMatchObject({ kind: "trace", traceId: headerTraceId });
    expect(typeof (f[0] as { turnId?: unknown }).turnId).toBe("string");
  });
});

describe("Gate-G abstain persists a packet with the honest reason", () => {
  it("insufficient_evidence / gate_g_no_evidence, no provider call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "what is F004", sourceDocIds: [DOC_A] }), params);
    await res.text();
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.answer_gate.decision).toBe("insufficient_evidence");
    expect(record.packet.answer_gate.reason).toBe("gate_g_no_evidence");
  });
});

describe("visualEvidence with no stored LOOK observation", () => {
  beforeEach(() => {
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-09-22T00:00:00.000Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
  });

  it("mira.visual.file_id lands on the root span, the packet carries the file id, and the honest anomaly set fires", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("Here is general guidance.")));
    const res = await POST(
      chatReq({ message: "what am I looking at", mode: "general", visualEvidence: { fileId: PHOTO } }),
      params,
    );
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));

    const spans = handle.finished();
    const root = spans.find((s) => s.name === "mira.turn");
    expect(root!.attributes["mira.visual.file_id"]).toBe(PHOTO);

    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.ids.file_ids).toContain(PHOTO);
    const codes = record.anomalies.map((a) => a.code).sort();
    // A photo attached, no stored observation, no doc evidence, no machine
    // evidence — the model still "answered" (general mode). Per anomalies.ts:
    // PHOTO_WITH_NO_OBSERVATIONS (has_visual_evidence && !observation_available)
    // and EQUIPMENT_ANSWER_WITH_NO_EVIDENCE (has_visual_evidence, answered, zero
    // evidence_doc_ids, zero visual_evidence_count) both fire.
    // VISUAL_EVIDENCE_DROPPED does NOT (observation_available is false and
    // prior_turn_observation_count is 0 — nothing was ever "dropped").
    expect(codes).toEqual(["EQUIPMENT_ANSWER_WITH_NO_EVIDENCE", "PHOTO_WITH_NO_OBSERVATIONS"]);
  });
});

describe("#4148 — part-number claims and unconfirmed manual lookup", () => {
  // These overrides are persistent (mockResolvedValue) and vi.clearAllMocks() does not
  // reset implementations, so without a restore the "Ni8U-S12-AP6" photo leaks into
  // every later test in this file and diverts OEM-retrieval tests into the part lookup.
  const saved: Array<[{ getMockImplementation: () => unknown; mockImplementation: (f: never) => unknown }, unknown]> = [];
  beforeEach(() => {
    for (const m of [domainMock.getNotebook, filesMock.photoLinkedToTarget, veMock.loadVisualEvidenceForPhoto, ragMock.retrieveManualChunks]) {
      saved.push([m as never, (m as unknown as { getMockImplementation: () => unknown }).getMockImplementation()]);
    }
    domainMock.getNotebook.mockResolvedValue({ id: NB, displayName: "Unbound part", manufacturer: null, model: null } as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: PHOTO, capturedAt: "2026-09-30T00:00:00.000Z" });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "o1", sessionId: "s1", text: "Label appears to read Ni8U-S12-AP6; wiring 1BN+ 3BU- 4BK",
      obsKind: "look", trust: "candidate", confidence: null, fileId: PHOTO, photoHash: null, observedAt: null,
    } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
  });
  afterEach(() => {
    for (const [m, impl] of saved.splice(0)) {
      (m as unknown as { mockReset: () => void }).mockReset();
      if (impl) m.mockImplementation(impl as never);
    }
  });

  it("does not answer a compatibility question by decoding an unconfirmed part number", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "Can I use my M12 instead of this S12?", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    const f = await frames(res);
    const status = f.find((x) => x.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("I can't verify whether those parts are interchangeable");
    expect(String(status?.message)).toContain("Ni8U-S12-AP6");
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const packet = firstRecordedPacket();
    expect(packet.retrieval.photo_part_manual_lookup).toBeNull();
    expect(JSON.stringify(packet)).not.toContain("Ni8U-S12-AP6");
  });

  it("the unverified-compatibility reply is generic — it names only the part the photo shows (#4148 review)", async () => {
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue({
      observationId: "o2", sessionId: "s2", text: "Label appears to read P/N 6ES7214-1AG40-0XB0",
      obsKind: "look", trust: "candidate", confidence: null, fileId: PHOTO, photoHash: null, observedAt: null,
    } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "Is this a drop-in replacement for a 6ES7214-1BG40?", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    const status = (await frames(res)).find((x) => x.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("6ES7214-1AG40-0XB0");
    expect(String(status?.message)).not.toMatch(/\bM12\b|\bS12\b/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches the exact part number when the technician explicitly asks for its manual", async () => {
    manualDiscoveryMock.discoverManual.mockResolvedValueOnce({
      serviceAvailable: true, found: true,
      candidate: { url: "https://docs.example/manual.pdf", title: "Possible manual", host: "docs.example", score: 20, docType: "pdf", isDirectPdf: true, validated: true },
      validated: true, isDirectPdf: true, oemHost: false, trustedDistributorHost: false,
      reason: "candidate found", oemRequestUrl: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "Look up the PDF manual", mode: "general", visualEvidence: { fileId: PHOTO } }), params);
    const f = await frames(res);
    const status = f.find((x) => x.kind === "status");
    expect(manualDiscoveryMock.discoverManual).toHaveBeenCalledWith({ catalogNumber: "Ni8U-S12-AP6" });
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("I searched for a manual using the exact label text");
    expect(String(status?.message)).toContain("https://docs.example/manual.pdf");
    expect(String(status?.message)).toContain("I haven't added it as a source");
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(firstRecordedPacket().retrieval.photo_part_manual_lookup).toMatchObject({
      searched: true,
      found: true,
      candidate_host: "docs.example",
    });
    expect(JSON.stringify(firstRecordedPacket())).not.toContain("Ni8U-S12-AP6");
  });
});

describe("recordTurn throwing still persists a packet", () => {
  it("persistence.outcome is 'failed'", async () => {
    domainMock.recordTurn.mockRejectedValueOnce(new Error("write unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance.")));
    const res = await POST(
      chatReq({ message: "how does a VFD work", mode: "general", clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      params,
    );
    // recordTurn failure with a clientRequestId calls controller.error(); the
    // stream body may reject, but persistence still runs before that return.
    await res.text().catch(() => undefined);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.persistence.outcome).toBe("failed");
  });
});

describe("no span leaks when a pre-stream stage throws", () => {
  it("resolveBoundAsset throwing ends the root span with ERROR status and ends identity.resolve", async () => {
    domainMock.resolveBoundAsset.mockRejectedValueOnce(new Error("db offline"));
    vi.stubGlobal("fetch", vi.fn());
    await expect(POST(chatReq({ message: "how do VFDs work", mode: "general" }), params)).rejects.toThrow("db offline");

    const spans = handle.finished();
    const root = spans.find((s) => s.name === "mira.turn");
    expect(root).toBeTruthy();
    expect(root!.status.code).toBe(SpanStatusCode.ERROR);
    expect(root!.attributes["mira.turn.aborted"]).toBe(true);
    // identity.resolve was started before the throw and must not leak open.
    const identity = spans.find((s) => s.name === "identity.resolve");
    expect(identity).toBeTruthy();
    expect(identity!.ended).toBe(true);
    // Nothing was persisted for a turn that never reached the stream.
    expect(persistMock.persistTurnUsage).not.toHaveBeenCalled();
  });

  it("identity.resolve carries the notebook's real manufacturer/model flags on span AND packet", async () => {
    // Default mock notebook: manufacturer "Allen-Bradley", model "PowerFlex 525".
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance here.", { prompt_tokens: 3, completion_tokens: 2 })));
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const identity = handle.finished().find((s) => s.name === "identity.resolve");
    expect(identity!.attributes["mira.identity.manufacturer_present"]).toBe(true);
    expect(identity!.attributes["mira.identity.model_present"]).toBe(true);
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.identity.manufacturer_present).toBe(true);
    expect(record.packet.identity.model_present).toBe(true);

    // Negative control: a notebook with no identity yields false on both.
    handle.reset();
    persistMock.persistTurnUsage.mockClear();
    domainMock.getNotebook.mockResolvedValueOnce({ id: NB, displayName: "Unknown box", manufacturer: null, model: null } as never);
    const res2 = await POST(chatReq({ message: "what is this", mode: "general" }), params);
    await res2.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const identity2 = handle.finished().find((s) => s.name === "identity.resolve");
    expect(identity2!.attributes["mira.identity.manufacturer_present"]).toBe(false);
    expect(identity2!.attributes["mira.identity.model_present"]).toBe(false);
  });
});

describe("per-stage timings land in the durable packet", () => {
  it("identity/retrieval/context/generation/persist durations are numbers on an answered turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance here.", { prompt_tokens: 3, completion_tokens: 2 })));
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    const t = record.packet.timings_ms;
    for (const k of ["identity", "retrieval", "context", "generation"] as const) {
      expect(typeof t[k], `timings_ms.${k}`).toBe("number");
      expect(t[k]).toBeGreaterThanOrEqual(0);
    }
    // persist is recorded from the span that wraps recordTurn; finish() runs
    // inside that span, so it is written by the LAST endTimed after persistence.
    // The packet copy captured at finish() may predate it — assert the trace
    // instead: the turn.persist span exists and has ended.
    const persist = handle.finished().find((s) => s.name === "turn.persist");
    expect(persist).toBeTruthy();
    expect(persist!.ended).toBe(true);
  });
});


describe("an unsampled turn still records its stage timings (#4107 review F2)", () => {
  it("at turn sample ratio 0 nothing exports, yet the packet's stage durations are numbers", async () => {
    const exporter = new InMemorySpanExporter();
    const unsampled = new BasicTracerProvider({
      sampler: turnOnlySampler(0),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }).getTracer("t");
    const spy = vi.spyOn(trace, "getTracer").mockReturnValue(unsampled);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance here.", { prompt_tokens: 3, completion_tokens: 2 })));
      const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
      await res.text();
      await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
      const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
      expect(exporter.getFinishedSpans()).toHaveLength(0);
      for (const k of ["identity", "retrieval", "context", "generation"] as const) {
        expect(typeof record.packet.timings_ms[k], `timings_ms.${k}`).toBe("number");
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("retrieval routing is decided by evidence context, not by general mode alone (2026-09-22)", () => {
  const chunk = (docId: string | null, sourceUrl = "https://oem.example/tp700.pdf") => ({ docId, sourceUrl, title: "TP700 Comfort Operating Instructions", content: "Rated 24 VDC, 0.85 A max.", sourcePage: 12, manufacturer: "Siemens", modelNumber: "TP700", rank: 1, verified: true });
  const oemChunk = () => chunk(null);
  const framesOf = (text: string) => text.split("\n\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)) as { kind: string; [k: string]: unknown });
  const packetOf = () => (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
  const nb = (extra: Record<string, unknown> = {}) => ({ id: NB, displayName: "Unknown box", manufacturer: null, model: null, ...extra });

  it("1. empty notebook + generic unrelated question → retrieval stays skipped", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("A VFD varies motor frequency.")));
    await (await POST(chatReq({ message: "how does a VFD work in general", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.strategy).toBe("skipped_general_mode");
    expect(p.retrieval.executed).toBe(false);
    expect(p.retrieval.oem_corpus_searched).toBe(false);
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  });

  it("2. empty notebook + resolved identity (manufacturer on the notebook) → OEM corpus retrieval runs, doc ids traceable, and the OEM chunks GROUND the turn", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([oemChunk()] as never);
    const fetchMock = vi.fn(async () => providerStream("Per the manual the supply is 24 VDC [1]."));
    vi.stubGlobal("fetch", fetchMock);
    const text = await (await POST(chatReq({ message: "what supply voltage does this panel need", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.strategy).toBe("oem_corpus_bm25");
    expect(p.retrieval.executed).toBe(true);
    expect(p.retrieval.oem_corpus_searched).toBe(true);
    expect(p.retrieval.oem_manufacturer_source).toBe("notebook");
    // Shared-OEM chunks have no doc id; their durable identity is source URL + page.
    expect(p.retrieval.returned_doc_ids).toEqual(["https://oem.example/tp700.pdf#p12"]);
    expect(p.answer_gate.evidence_sufficient).toBe(true);
    // Staging trace abea7c10… regression: the chunks must REACH the model and
    // the wire, not be discarded by general-mode downstream. Grounded system
    // prompt (grounding rules appended), [1] preserved in the answer, citation
    // shipped, and the evidence badge says OEM documentation.
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).not.toContain("No manual for this machine has been loaded");
    expect(p.context.system_prompt_kind).toBe("grounded");
    const frames = framesOf(text);
    expect(frames.find((f) => f.kind === "sources")?.citations).toHaveLength(1);
    const ev = frames.find((f) => f.kind === "evidence") as { basis?: string; label?: string } | undefined;
    expect(ev?.basis).toBe("oem_documentation");
    expect(ev?.label).toContain("manufacturer's documentation");
    expect(text).toContain("[1]");
    const [, , opts] = ragMock.retrieveManualChunks.mock.calls[0] as unknown as [unknown, unknown, string, { manufacturer: string; allowTenantFallback: boolean }];
    void opts;
    const call = ragMock.retrieveManualChunks.mock.calls[0] as unknown as [unknown, string, string, { manufacturer: string; model?: string | null; allowTenantFallback: boolean }];
    expect(call[3].manufacturer).toBe("Siemens");
    expect(call[3].model).toBe("TP700 Comfort");
    expect(call[3].allowTenantFallback).toBe(false);
    expect(p.retrieval.oem_model).toBe("TP700 Comfort");
    expect(p.retrieval.oem_model_source).toBe("notebook");
    expect(ragMock.retrieveNodeChunks).not.toHaveBeenCalled();
  });

  it("2b. identity from the PHOTO observation (no notebook manufacturer) → OEM retrieval scoped to the recognised vendor", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({ observationId: "o1", sessionId: "s1", text: "SIEMENS TP700 Comfort 6AV2124-0GC01-0AX0, 24 VDC", obsKind: "look", trust: "candidate", confidence: null, fileId: FILE_ID, photoHash: null, observedAt: null } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([oemChunk()] as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The panel takes 24 VDC [1].")));
    await (await POST(chatReq({ message: "what does it run on", mode: "general", visualEvidence: { fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" } }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.strategy).toBe("oem_corpus_bm25");
    expect(p.retrieval.oem_manufacturer_source).toBe("photo");
    expect(p.visual_evidence.observation_in_context).toBe(true);
  });


  it("2c. #3966 NEGATIVE CONTROL: TP700 identity passes model so retrieval cannot manufacturer-fall-through to V20", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    // Empty retrieval is the honest refuse-to-cite outcome when no TP700 manual
    // is in corpus — the invariant under test is that opts carry model/type.
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerStream("I don't have a matching manual for this TP700.")),
    );
    await (
      await POST(
        chatReq({ message: "it keeps rebooting, what do I check first", mode: "general" }),
        params,
      )
    ).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.oem_corpus_searched).toBe(true);
    expect(p.retrieval.oem_model).toBe("TP700 Comfort");
    expect(p.retrieval.oem_model_source).toBe("notebook");
    const call = ragMock.retrieveManualChunks.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { manufacturer: string; model?: string | null; equipmentType?: string | null },
    ];
    expect(call[3].manufacturer).toBe("Siemens");
    expect(call[3].model).toBe("TP700 Comfort");
    expect(call[3].equipmentType).toBe("HMIs");
  });

  it("2d. #4004: identity-bound + empty scoped retrieval + documented-value question → honest abstain, no provider call", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(
        chatReq({
          message: "what supply voltage does the TP700 Comfort panel need and what is its operating temperature range",
          mode: "general",
        }),
        params,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("Siemens TP700 Comfort manual");
    expect(fr.some((f) => f.kind === "content")).toBe(false);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.answer_gate.decision).toBe("insufficient_evidence");
    expect(p.answer_gate.reason).toBe("identity_bound_no_manual");
    const rec = (domainMock.recordTurn.mock.calls[0] as unknown[])[2] as { answerStatus: string; answerText: string };
    expect(rec.answerStatus).toBe("insufficient_evidence");
    expect(rec.answerText).toContain("won't guess");
  });

  it("2e. #4004/#4068 control: identity-bound + empty retrieval + a CONCEPTUAL question still answers (general lane)", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn(async () => providerStream("A resistive touch panel senses pressure between two layers."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "how does a touch panel work", mode: "general" }), params));
    expect(fetchMock).toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.status).toBe("answered");
  });

  it("2h. #4068 (owner decision 2026-09-27): identity-bound + nothing citable + a troubleshooting question → honest decline, no provider call", async () => {
    // Before #4068 this turn answered from general reasoning with no citation
    // (it was 2e's old fixture). The owner chose: widen to the same family,
    // then decline honestly — never an uncited answer about THIS machine.
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "it keeps rebooting, what do I check first", mode: "general" }), params));
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("Siemens TP700 Comfort manuals");
    expect(String(status?.message)).toContain("won't guess");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.answer_gate.reason).toBe("identity_bound_no_evidence");
  });

  it("2h-i. 2026-09-28 Answer Radar seed 006: a passcode request declines toward the owner/OEM, not a manual upload", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Demag", model: "DC-Pro" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "what is the service passcode for this hoist, what should I check", mode: "general" }), params));
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("Demag service");
    expect(String(status?.message)).not.toContain("photograph the nameplate");
  });

  it("2h-i-b. Codex #4094 F1: a bare 'service PIN' request also declines toward the owner/OEM", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Demag", model: "DC-Pro" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "What is the service PIN on my hoist, what should I check?", mode: "general" }), params));
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("Demag service");
    expect(String(status?.message)).not.toContain("photograph the nameplate");
  });

  it("2h-i-c. Codex #4094 post-cap r3 F3: a numbered cable pin in the same sentence does not hide a login PIN", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Demag", model: "DC-Pro" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(
        chatReq({ message: "What is the login PIN to unlock my PLC, and what does PIN 4 on its cable do?", mode: "general" }),
        params,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("Demag service");
  });

  it("2h-ii. 2026-09-28 Answer Radar seed 003: firmware recovery declines toward OEM service", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "AUMA", model: "AC 01.2" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(chatReq({ message: "the actuator firmware got corrupted, what do I check first to recover it", mode: "general" }), params),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("AUMA service");
  });

  it("2j. Codex #4069 F1: a mixed teaching+troubleshooting question about this machine still declines", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "PowerFlex 525" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(chatReq({ message: "How does my drive work when it trips on F005, and what should I check first?", mode: "general" }), params),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.status).toBe("insufficient_evidence");
  });

  it("2k. Codex #4069 F4: a FAILED OEM query is never presented as 'couldn't find it' — retryable, honest", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockRejectedValueOnce(new Error("connection terminated") as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "it keeps rebooting, what do I check first", mode: "general" }), params));
    expect(fetchMock).not.toHaveBeenCalled();
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("couldn't reach the manual library");
    expect(String(status?.message)).not.toContain("Upload");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().answer_gate.reason).toBe("identity_bound_retrieval_failed");
    // Codex #4069 pass 9 F2: an outage is not recorded as a completed empty search.
    expect(packetOf().retrieval.zero_result_reason).toBe("oem_query_failed");
  });

  it("2k2. Codex #4069 pass 9 F2: a COMPLETED empty OEM search still records no_matches", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValue([] as never);
    vi.stubGlobal("fetch", vi.fn());
    await frames(await POST(chatReq({ message: "it keeps rebooting, what do I check first", mode: "general" }), params));
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.zero_result_reason).toBe("no_matches");
  });

  it("2l. #4068 owner decision ('allow with a warning'): related-manual answers carry a fixed server-written warning", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "SLC 5/03" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([{ ...oemChunk(), retrievalScope: "vendor_fallback" }] as never);
    const fetchMock = vi.fn(async () => providerStream("A related CompactLogix manual says DH-485 needs a 1761-NET-AIC [1]."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "why did it stop communicating after the swap", mode: "general" }), params));
    expect(fetchMock).toHaveBeenCalled();
    const shown = fr.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(shown.startsWith("⚠️ No page of the Allen-Bradley SLC 5/03 manual matched this question")).toBe(true);
    expect(shown).toContain("confirm them in your SLC 5/03 manual before you act");
    const rec = (domainMock.recordTurn.mock.calls[0] as unknown[])[2] as { answerText: string };
    expect(rec.answerText).toContain("The closest match is a related manual");
    // Post-cap F3: a query miss is never presented as an absent manual.
    expect(shown).not.toMatch(/manual was found|manual was not found|no .* manual exists/i);
    const sent = JSON.stringify((fetchMock.mock.calls[0] as unknown[])[1]);
    expect(sent).toContain("RELATED-MANUAL EXCERPTS");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.oem_scope).toBe("vendor_fallback");
  });

  it("2l2. Codex #4069 pass 11 F2: gate-off, a streamed related-manual note never claims a refusal used it", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "SLC 5/03" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([{ ...oemChunk(), retrievalScope: "vendor_fallback" }] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("I don't have documentation covering that, so I can't answer it.")));
    const fr = await frames(await POST(chatReq({ message: "why did it stop communicating after the swap", mode: "general" }), params));
    const shown = fr.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    expect(shown).not.toMatch(/this answer uses|answer uses a related/i);
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
  });

  it("2l3. Codex #4069 pass 18 F2: a stopped gate-off related-manual turn saves the warning the tech saw", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "SLC 5/03" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([{ ...oemChunk(), retrievalScope: "vendor_fallback" }] as never);
    const enc2 = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc2.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "A related manual says " } }] })}\n\n`));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const res = await POST(chatReq({ message: "why did it stop communicating after the swap", mode: "general" }), params);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let received = "";
    while (!received.includes("A related manual says")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += dec.decode(value, { stream: true });
    }
    await reader.cancel();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalledTimes(1));
    const rec = (domainMock.recordTurn.mock.calls[0] as unknown[])[2] as { answerText: string | null };
    expect(received).toContain("The closest match is a related manual");
    expect(rec.answerText?.startsWith("⚠️ No page of the Allen-Bradley SLC 5/03 manual matched this question")).toBe(true);
    expect(rec.answerText).toContain("A related manual says");
  });

  it("2m. #4068 related-manual warning with the answer gate ON (the production default)", async () => {
    delete process.env.NOTEBOOK_ANSWER_GATE;
    try {
      domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "SLC 5/03" }) as never);
      ragMock.retrieveManualChunks.mockResolvedValueOnce([{ ...oemChunk(), retrievalScope: "vendor_fallback" }] as never);
      vi.stubGlobal("fetch", vi.fn(async () => providerStream("A related CompactLogix manual says DH-485 needs a 1761-NET-AIC [1].")));
      const fr = await frames(await POST(chatReq({ message: "why did it stop communicating after the swap", mode: "general" }), params));
      const shown = fr.filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
      expect(shown.startsWith("⚠️ No page of the Allen-Bradley SLC 5/03 manual matched this question")).toBe(true);
    } finally {
      process.env.NOTEBOOK_ANSWER_GATE = "0";
    }
  });

  it("2n. Codex #4069 pass 5 F3: an unclassified model's decline never claims related manuals were searched", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Allen-Bradley", model: "XR-9000" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal("fetch", vi.fn());
    const fr = await frames(await POST(chatReq({ message: "it stopped communicating, what should I check first", mode: "general" }), params));
    const msg = String(fr.find((f) => f.kind === "status")?.message);
    expect(msg).toContain("Allen-Bradley XR-9000 manuals");
    expect(msg).not.toContain("related manuals");
  });

  it("2i. #4068: a hazard turn is never swallowed by the new decline (owner decision: flag, never block)", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn(async () => providerStream("De-energize and apply lockout/tagout before opening the panel."));
    vi.stubGlobal("fetch", fetchMock);
    await (
      await POST(chatReq({ message: "the panel keeps rebooting, I need to work on the live panel to check it, what should I check", mode: "general" }), params)
    ).text();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("2f. #4004 control: identity-bound WITH scoped chunks + documented-value question → grounded, not abstained", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens", model: "TP700 Comfort" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([oemChunk()] as never);
    const fetchMock = vi.fn(async () => providerStream("The panel needs 24 V DC [1]."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "what supply voltage does the TP700 Comfort need", mode: "general" }), params));
    expect(fetchMock).toHaveBeenCalled();
    expect(fr.find((f) => f.kind === "status")?.message ?? "").not.toContain("manual in the library");
  });

  it("2o. Codex #4069 pass 7 F3: a manufacturer-only notebook's OEM hits are recorded as manufacturer scope, never model scope", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([oemChunk()] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("Check the 24 V supply [1].")));
    await (await POST(chatReq({ message: "why does the panel reboot", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.oem_scope).toBe("manufacturer");
  });

  it("2g. #4004 control: a manufacturer-only notebook (no model) keeps the pre-existing path — not identity-bound", async () => {
    domainMock.getNotebook.mockResolvedValue(nb({ manufacturer: "Siemens" }) as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn(async () => providerStream("Typical panels use 24 V DC; check the nameplate."));
    vi.stubGlobal("fetch", fetchMock);
    await (await POST(chatReq({ message: "what supply voltage does it need", mode: "general" }), params)).text();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("3. notebook with an attached manual → notebook retrieval, source_doc_count > 0 (unchanged path)", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    ragMock.retrieveNodeChunks.mockResolvedValueOnce([chunk(DOC_A, "")] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("Rated 24 VDC [1].")));
    await (await POST(chatReq({ message: "rated voltage?", sourceDocIds: [DOC_A] }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.strategy).toBe("notebook_sources_bm25");
    expect(p.request.source_doc_count).toBeGreaterThan(0);
    expect(p.retrieval.returned_doc_ids).toEqual([DOC_A]);
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  });

  it("five concurrent historical recalls do not nest connections in the five-slot pool", async () => {
    const tenant = vi.mocked(withTenantContext);
    const original = tenant.getMockImplementation()!;
    let active = 0;
    let exhausted = 0;
    let arrived = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    tenant.mockImplementation(async (_id, fn) => {
      if (active === 5) { exhausted++; throw new Error("pool acquisition timeout"); }
      active++;
      try { return await fn({ query: vi.fn(async () => ({ rows: [] })) } as never); }
      finally { active--; }
    });
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    domainMock.listTurns.mockResolvedValue(Array.from({ length: 1 }, () => ({
      id: "old", answerStatus: "answered", answerText: "A panel label.",
      evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z", provenance: "phone_photo" }],
    })) as never);
    filesMock.photoLinkedToTarget.mockImplementation(() => withTenantContext(TENANT_A, async () => ({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" })));
    veMock.loadRecentLookObservations.mockImplementation(async () => {
      if (++arrived === 5) releaseBarrier();
      await barrier;
      return [];
    });
    veMock.loadVisualEvidenceForPhoto.mockResolvedValue({ fileId: FILE_ID, text: "Panel label", observedAt: "2026-09-22T00:00:00Z" });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The earlier photo shows a panel label.")));
    try {
      await Promise.all(Array.from({ length: 5 }, async (_, i) => (await POST(chatReq({ message: `what was in photo ${i}?`, mode: "general" }), params)).text()));
      expect(exhausted).toBe(0);
      expect(veMock.loadVisualEvidenceForPhoto).toHaveBeenCalledTimes(5);
    } finally {
      tenant.mockImplementation(original);
      domainMock.listTurns.mockResolvedValue([]);
      filesMock.photoLinkedToTarget.mockResolvedValue(null);
      veMock.loadRecentLookObservations.mockImplementation(async () => []);
      veMock.loadVisualEvidenceForPhoto.mockResolvedValue(null);
    }
  });

  it.each([
    { answerStatus: "answered", answerText: null, linked: true },
    { answerStatus: "answered", answerText: "   ", linked: true },
    { answerStatus: "insufficient_evidence", answerText: "No supporting evidence.", linked: true },
    { answerStatus: "answered", answerText: "Photo answer", linked: false },
  ])("does not recall an ineligible historical photo: %j", async ({ answerStatus, answerText, linked }) => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "old", answerStatus, answerText, evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z", provenance: "phone_photo" }] },
    ] as never);
    veMock.loadRecentLookObservations.mockResolvedValueOnce([]);
    filesMock.photoLinkedToTarget.mockResolvedValue(linked ? { fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" } : null);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("Please attach the photo again.")));
    await (await POST(chatReq({ message: "what voltage was it?", mode: "general" }), params)).text();
    expect(veMock.loadVisualEvidenceForPhoto).not.toHaveBeenCalled();
  });

  it("4. photo turn followed by a text-only follow-up → prior observation recalled SERVER-side", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" });
    // The earlier turn persisted a visual_observation{fileId} on its row; the
    // client re-sends nothing but text history.
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "t1", threadId: "th", question: "what is this", answerStatus: "answered", answerText: "…", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:13:53Z", provenance: "phone_photo" }], basis: "general_reasoning", createdAt: "2026-09-22T05:14:04Z", ownerUserId: "u1" },
    ] as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({ observationId: "o1", sessionId: "s1", text: "Siemens TP700 Comfort, Supply 24 Vdc max 0.85 A", obsKind: "look", trust: "candidate", confidence: null, fileId: FILE_ID, photoHash: null, observedAt: null } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("From the earlier photo it is 24 Vdc.")));
    await (await POST(chatReq({ message: "what voltage was it?", mode: "general", history: [{ role: "user", content: "what is this" }, { role: "assistant", content: "…" }] }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.visual_evidence.prior_turn_observation_count).toBe(1);
    expect(p.visual_evidence.prior_file_ids).toEqual([FILE_ID]);
    expect(p.retrieval.prior_visual_observations_considered).toBe(1);
    expect(p.context.visual_evidence_count).toBe(1);
    expect(p.answer_gate.evidence_sufficient).toBe(true);
    // Recognised vendor from the recalled photo also unlocks OEM retrieval.
    expect(p.retrieval.oem_corpus_searched).toBe(true);
    expect(p.retrieval.oem_manufacturer_source).toBe("photo");
    // VISUAL_EVIDENCE_DROPPED must NOT fire: the evidence reached context.
    expect((persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].anomalies.map((a) => a.code)).not.toContain("VISUAL_EVIDENCE_DROPPED");
  });

  it("4b. scenario 4: a photo uploaded WITHOUT a threadId (pre-#3968 app) is still recalled in the thread that answered from it", async () => {
    const TH = "thrd_" + "a".repeat(32);
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" });
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "t1", threadId: TH, question: "what is this", answerStatus: "answered", answerText: "A panel.", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:13:53Z", provenance: "phone_photo" }], basis: "workspace_evidence", createdAt: "2026-09-22T05:14:04Z", ownerUserId: "u1" },
    ] as never);
    // Thread-scoped lookup misses (the LOOK was stored under "legacy"); the
    // legacy-thread lookup for the SAME verified photo finds it.
    veMock.loadVisualEvidenceForPhoto
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ observationId: "o1", sessionId: "s1", text: "Siemens TP700 Comfort, Supply 24 Vdc", obsKind: "look", trust: "candidate", confidence: null, fileId: FILE_ID, photoHash: null, observedAt: null } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("From the earlier photo it is 24 Vdc.")));
    await (await POST(chatReq({ message: "what voltage was it?", mode: "general", threadId: TH }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const scopes = veMock.loadVisualEvidenceForPhoto.mock.calls.map((c) => (c as unknown[])[3] as { threadId: string | null; allowLegacy?: boolean });
    expect(scopes[0]).toMatchObject({ threadId: TH, allowLegacy: true });
    expect(scopes[1]).toMatchObject({ threadId: null });
    expect(packetOf().retrieval.prior_visual_observations_considered).toBe(1);
    // #4010 review: the legacy fallback drops the thread filter, so its safety
    // rests on `seen` being built ONLY from answered turns of THIS thread. Pin
    // that the history read is thread-scoped — widening it must break here.
    const listCall = domainMock.listTurns.mock.calls[0] as unknown as [string, string, number, { threadId?: string | null }];
    expect(listCall[3]).toMatchObject({ threadId: TH });
  });

  it("4c. scenario 4 control: with no threadId on the chat there is no second (legacy) lookup", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" });
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "t1", threadId: null, question: "what is this", answerStatus: "answered", answerText: "A panel.", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:13:53Z", provenance: "phone_photo" }], basis: "workspace_evidence", createdAt: "2026-09-22T05:14:04Z", ownerUserId: "u1" },
    ] as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce(null as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("I can't see an earlier photo.")));
    await (await POST(chatReq({ message: "what voltage was it?", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(veMock.loadVisualEvidenceForPhoto).toHaveBeenCalledTimes(1);
  });

  it("4a. the newest recalled photo alone selects OEM identity when an older photo is a different model", async () => {
    const olderFile = "55555555-5555-4555-8555-555555555555";
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "old", threadId: "th", answerStatus: "answered", answerText: "A panel.", evidence: [{ kind: "visual_observation", fileId: olderFile, capturedAt: "2026-09-22T04:00:00Z", provenance: "phone_photo" }] },
      { id: "new", threadId: "th", answerStatus: "answered", answerText: "A drive.", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:00:00Z", provenance: "phone_photo" }] },
    ] as never);
    filesMock.photoLinkedToTarget
      .mockResolvedValueOnce({ fileId: FILE_ID, capturedAt: "2026-09-22T05:00:00Z" })
      .mockResolvedValueOnce({ fileId: olderFile, capturedAt: "2026-09-22T04:00:00Z" });
    veMock.loadVisualEvidenceForPhoto
      .mockResolvedValueOnce({ text: "Siemens SINAMICS V20 drive", fileId: FILE_ID, observedAt: "2026-09-22T05:00:00Z" } as never)
      .mockResolvedValueOnce({ text: "Siemens TP700 Comfort panel", fileId: olderFile, observedAt: "2026-09-22T04:00:00Z" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("I need the matching manual.")));
    await (await POST(chatReq({ message: "what should I check on the last photo?", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.visual_evidence.prior_turn_observation_count).toBe(2);
    expect(p.retrieval.oem_model).toBe("V20");
    expect(p.retrieval.oem_model_source).toBe("photo");
    const call = ragMock.retrieveManualChunks.mock.calls[0] as unknown as [unknown, string, string, { model: string }];
    expect(call[3].model).toBe("V20");
    expect(ragMock.resolveModelFromObservationText).toHaveBeenCalledWith("Siemens SINAMICS V20 drive");
  });

  it("4aa. conflicting models in one LOOK observation skip OEM citation retrieval", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({ text: "Siemens TP700 Comfort panel beside SINAMICS V20 drive", fileId: FILE_ID } as never);
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The photo describes more than one machine; identify which one you mean.")));
    const res = await POST(chatReq({ message: "what should I check?", mode: "general", visualEvidence: { fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" } }), params);
    expect(res.status).toBe(200);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.retrieval.oem_corpus_searched).toBe(false);
    expect(p.retrieval.oem_model).toBeNull();
    expect(p.retrieval.zero_result_reason).toBe("ambiguous_model_observation");
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
  });

  it("4b. #3966 NEGATIVE CONTROL: identity extraction failure skips OEM citation but answers the turn", async () => {
    // A parser failure cannot turn a TP700 observation into Siemens-wide BM25:
    // a V20 chunk would be a wrong-machine citation. The turn still answers.
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00Z" });
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "t1", threadId: "th", question: "what is this", answerStatus: "answered", answerText: "…", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:13:53Z", provenance: "phone_photo" }], basis: "general_reasoning", createdAt: "2026-09-22T05:14:04Z", ownerUserId: "u1" },
    ] as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({ observationId: "o1", sessionId: "s1", text: "Siemens TP700 Comfort, Supply 24 Vdc max 0.85 A", obsKind: "look", trust: "candidate", confidence: null, fileId: FILE_ID, photoHash: null, observedAt: null } as never);
    ragMock.resolveModelFromObservationText.mockImplementationOnce(() => {
      throw new Error("identity seam unavailable");
    });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("From the earlier photo it is 24 Vdc.")));
    const res = await POST(chatReq({ message: "what voltage was it?", mode: "general", history: [{ role: "user", content: "what is this" }, { role: "assistant", content: "…" }] }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    // The turn survived and still recalled the photo …
    expect(p.visual_evidence.prior_turn_observation_count).toBe(1);
    // … but no manufacturer-only retrieval or OEM citation is allowed.
    expect(p.retrieval.oem_model).toBeNull();
    expect(p.retrieval.oem_model_source).toBeNull();
    expect(p.retrieval.oem_corpus_searched).toBe(false);
    expect(p.retrieval.zero_result_reason).toBe("model_extraction_failed");
    expect(p.retrieval.returned_doc_ids).toEqual([]);
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
    expect(framesOf(text).find((f) => f.kind === "sources")?.citations ?? []).toEqual([]);
  });

  it("6. token usage lands in the packet (staging rows showed tokens=None/None)", async () => {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("A VFD varies frequency.", { prompt_tokens: 321, completion_tokens: 45 })));
    await (await POST(chatReq({ message: "how does a VFD work", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.generation.input_tokens).toBe(321);
    expect(p.generation.output_tokens).toBe(45);
  });

  it("badge: a photo-grounded answer with no shipped citation is labelled as the photo, not documentation or general", async () => {
    // Staging cf204938 (photo turn, badge 'general') / 104883fb (text follow-up,
    // OEM chunks in context but 0 citations, badge 'manufacturer documentation').
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    veMock.loadVisualEvidenceForPhoto.mockResolvedValueOnce({ observationId: "o1", sessionId: "s1", text: "SIEMENS TP700 Comfort, Supply 24 Vdc max 0.85 A", obsKind: "look", trust: "candidate", confidence: null, fileId: FILE_ID, photoHash: null, observedAt: null } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([oemChunk()] as never); // retrieved, but the answer cites nothing
    filesMock.photoLinkedToTarget.mockResolvedValue({ fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" });
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("It runs on 24 V DC per the label.")));
    const text = await (await POST(chatReq({ message: "what does it run on", mode: "general", visualEvidence: { fileId: FILE_ID, capturedAt: "2026-09-22T00:00:00.000Z" } }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const ev = framesOf(text).find((f) => f.kind === "evidence") as { basis?: string; label?: string } | undefined;
    expect(ev?.basis).toBe("workspace_evidence");
    expect(ev?.label).toContain("attached photo");
    expect(framesOf(text).find((f) => f.kind === "sources")?.citations).toHaveLength(0);
    // OEM chunks still reached the model (evidence ids recorded) — the badge
    // just tells the truth about what the ANSWER rested on.
    expect(packetOf().context.evidence_doc_ids).toEqual(["https://oem.example/tp700.pdf#p12"]);
  });

  it("5. insufficient evidence + exact unit-bearing claim → withheld by the pre-display gate (fail closed)", async () => {
    // This suite runs with the gate OFF (detection-only) for the trace tests;
    // enforcement is the production default (NOTEBOOK_ANSWER_GATE unset).
    delete process.env.NOTEBOOK_ANSWER_GATE;
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The operating temperature range is -20 °C to +60 °C for this unit.")));
    const res = await POST(chatReq({ message: "what is the operating range outdoors", mode: "general" }), params);
    const text = await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.answer_gate.evidence_sufficient).toBe(false);
    expect(p.answer_gate.decision).toBe("blocked");
    expect(p.answer_gate.reason).toBe("unsupported-specificity:exact-rating");
    // The unsupported number never reached the wire; the honest fallback did.
    expect(text).not.toContain("+60");
    expect(text).toContain("won't guess");
    // #4098: WHICH grammar terms fired is recorded — closed-vocabulary tokens,
    // never answer text, so the packet's content ban still holds.
    expect(p.answer_gate.gate_match).toEqual({ term: "operating", unit: "°c" });
    expect(JSON.stringify(p)).not.toContain("+60");
  });

  it("5c. #4098 seed 002: a manual-location question that trips the gate gets a documentation next step", async () => {
    delete process.env.NOTEBOOK_ANSWER_GATE;
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The SPC-100 supply voltage is 24 VDC and its manual is on the Festo site.")));
    const raw = await (
      await POST(chatReq({ message: "I need the manual and the WinPISA software for an obsolete Festo SPC-100-P-F. Where is the documentation?", mode: "general" }), params)
    ).text();
    // Content is released in ~120-char frames; join them before matching.
    const text = framesOf(raw).filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().answer_gate.decision).toBe("blocked");
    // The relevant next step is there (#4098); the fault step is labelled as
    // conditional rather than presented as the answer (#4104 review).
    expect(text).toContain("If you need the document itself");
    expect(text).toContain("If this is about a fault or a stopped machine");
  });

  it("5d. #4098 control (#4104 F1): a tripping question keeps the fault-triage steps", async () => {
    delete process.env.NOTEBOOK_ANSWER_GATE;
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The supply voltage is 480 VAC.")));
    const raw = await (await POST(chatReq({ message: "my drive keeps tripping on overvoltage", mode: "general" }), params)).text();
    const text = framesOf(raw).filter((f) => f.kind === "content").map((f) => String(f.content)).join("");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().answer_gate.decision).toBe("blocked");
    expect(text).toContain("If this is about a fault or a stopped machine: confirm the exact code");
  });

  it("5b. with the emergency lever NOTEBOOK_ANSWER_GATE=0 the claim is served but still flagged in the packet", async () => {
    process.env.NOTEBOOK_ANSWER_GATE = "0";
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("The operating temperature range is -20 °C to +60 °C for this unit.")));
    await (await POST(chatReq({ message: "what is the operating range outdoors", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    expect(p.answer_gate.decision).toBe("answered");
    expect(p.answer_gate.evidence_sufficient).toBe(false);
    expect(p.answer_gate.ungrounded_unit_claim).toBe(true);
  });
});

describe("no span attribute ever carries a secret", () => {
  it("provider key / cookie strings never appear in any exported span attribute value", async () => {
    process.env.GROQ_API_KEY = "gsk_super_secret_value_123";
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance.")));
    const res = await POST(chatReq({ message: "q", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));

    const spans = handle.finished();
    for (const s of spans) {
      for (const [key, value] of Object.entries(s.attributes)) {
        const v = JSON.stringify(value);
        expect(v, `attribute ${key} on span ${s.name}`).not.toContain("gsk_super_secret_value_123");
        expect(v, `attribute ${key} on span ${s.name}`).not.toMatch(/cookie/i);
      }
    }
  });
});

describe("Jev shadow sufficiency on the packet (MIRA_JEV_SHADOW)", () => {
  const nb = () => ({ id: NB, displayName: "Unknown box", manufacturer: null, model: null });
  const chunk = () => ({ docId: DOC_A, sourceUrl: "https://oem.example/tp700.pdf", title: "TP700 Comfort Operating Instructions", content: "Rated 24 VDC, 0.85 A max.", sourcePage: 12, manufacturer: "Siemens", modelNumber: "TP700", rank: 1, verified: true });
  /** A grounded turn: the notebook has an attached manual and retrieval returns one chunk. */
  function grounded() {
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    ragMock.retrieveNodeChunks.mockResolvedValueOnce([chunk()] as never);
    return chatReq({ message: "rated voltage?", sourceDocIds: [DOC_A] });
  }
  /** Route fetch by URL: the Jev endpoint gets a JSON judgment, everything else the provider stream. */
  function splitFetch(jev: () => Promise<Response>) {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (u.startsWith("https://api.typesafe.ai/")) return jev();
      return providerStream("General guidance here.", { prompt_tokens: 3, completion_tokens: 2 });
    });
  }

  it("off by default: the packet carries nulls and no vendor call is made", async () => {
    delete process.env.MIRA_JEV_SHADOW;
    process.env.JEV_API_KEY = "present-but-disabled";
    const fetchMock = splitFetch(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.answer_gate).toMatchObject({ decision: "answered", jev_sufficient: null, jev_skipped_reason: "disabled", jev_latency_ms: null });
    const urls = fetchMock.mock.calls.map(([u]) => (typeof u === "string" ? u : String(u)));
    expect(urls.some((u) => u.includes("typesafe.ai"))).toBe(false);
  });

  it("on, nothing retrieved: no vendor call, packet says no_evidence", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    process.env.JEV_API_KEY = "stg-key";
    const fetchMock = splitFetch(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(chatReq({ message: "how do VFDs work", mode: "general" }), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.answer_gate).toMatchObject({ decision: "answered", evidence_sufficient: false, jev_sufficient: null, jev_skipped_reason: "no_evidence" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("typesafe.ai"))).toBe(false);
  });

  it("on, chunks retrieved: the judgment is recorded beside evidence_sufficient and the gate decision is unchanged", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    process.env.JEV_API_KEY = "stg-key";
    const fetchMock = splitFetch(async () =>
      new Response(JSON.stringify({ model: "jev-1.13.0", answers: { sufficient: { noul: 0.07 } }, usage: { input_tokens: 40 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(grounded(), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    // Shadow: recorded, not consulted — the presence flag says sufficient, Jev
    // says 0.07, and the answered decision is untouched by the disagreement.
    expect(record.packet.answer_gate.decision).toBe("answered");
    expect(record.packet.answer_gate.evidence_sufficient).toBe(true);
    expect(record.packet.answer_gate.jev_sufficient).toBe(0.07);
    expect(record.packet.answer_gate.jev_skipped_reason).toBeNull();
    expect(record.packet.answer_gate.jev_input_tokens).toBe(40);
    expect(typeof record.packet.answer_gate.jev_latency_ms).toBe("number");
    const jevCall = fetchMock.mock.calls.find(([u]) => String(u).includes("typesafe.ai"));
    expect(jevCall).toBeTruthy();
    const init = jevCall![1]!;
    expect(JSON.parse(init.body as string).questions.sufficient.type).toBe("noul");
    // Packet privacy: the key never lands in the packet.
    expect(JSON.stringify(record.packet)).not.toContain("stg-key");
  });

  it("on, vendor down: fail-open — the turn is answered and the packet records the skip", async () => {
    process.env.MIRA_JEV_SHADOW = "1";
    process.env.JEV_API_KEY = "stg-key";
    vi.stubGlobal(
      "fetch",
      splitFetch(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const res = await POST(grounded(), params);
    await res.text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const [, , record] = persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord];
    expect(record.packet.answer_gate.decision).toBe("answered");
    expect(record.packet.answer_gate).toMatchObject({ evidence_sufficient: true, jev_sufficient: null, jev_skipped_reason: "error" });
  });
});

describe("#4099: the MACHINE CONTEXT block is sent only when it states a fact", () => {
  const nbOf = (extra: Record<string, unknown> = {}) => ({ id: NB, displayName: "General", manufacturer: null, model: null, ...extra });
  async function systemPromptFor(message: string, notebook: Record<string, unknown>, docs: string[] = []): Promise<string> {
    domainMock.getNotebook.mockResolvedValue(notebook as never);
    // The suite default lists PF525.pdf as a loaded source; a blank chat has none.
    domainMock.listSources.mockResolvedValue((docs.length ? [{ filename: "PF525.pdf", docId: DOC_A }] : []) as never);
    domainMock.validateChatSources.mockResolvedValue({ ok: true, docIds: docs, nodeId: "n1" } as never);
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: { body?: string }) => {
        if (init?.body) bodies.push(JSON.parse(init.body));
        return providerStream("B");
      }),
    );
    await (await POST(chatReq({ message, mode: "general", sourceDocIds: docs }), params)).text();
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    return bodies[0].messages.find((m) => m.role === "system")!.content;
  }

  it("a blank chat (no identity, no asset, no documents) sends no block", async () => {
    // Measured on gpt-oss-120b with the served params: with this empty block the
    // Q9 option letter contradicted its own worked answer in 7 of 16 samples;
    // with it removed, 0 of 16.
    const sys = await systemPromptFor("how does a VFD work", nbOf());
    expect(sys).not.toContain("MACHINE CONTEXT");
    expect(sys).not.toContain("an unspecified machine");
    expect(sys).not.toContain('"General"');
  });

  it("a known manufacturer/model still sends the block", async () => {
    const sys = await systemPromptFor("how does a VFD work", nbOf({ manufacturer: "Allen-Bradley", model: "PowerFlex 525" }));
    expect(sys).toContain("MACHINE CONTEXT");
    expect(sys).toContain("Allen-Bradley PowerFlex 525");
  });

  it("loaded documents still send the block", async () => {
    const sys = await systemPromptFor("how does a VFD work", nbOf(), [DOC_A]);
    expect(sys).toContain("MACHINE CONTEXT");
    expect(sys).toContain("Loaded source documents: PF525.pdf");
  });
});

describe("#4095 — a blank chat PROPOSES the named machine, never binds it", () => {
  const packetOf = () => (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
  const unbound = { id: NB, displayName: "Unknown box", manufacturer: null, model: null };
  const systemPromptOf = (fetchMock: ReturnType<typeof vi.fn>) => {
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as {
      messages: { role: string; content: string }[];
    };
    return body.messages[0].content;
  };

  it("names a library manufacturer + model → identity_proposal frame, packet record, unconfirmed directive; retrieval unchanged", async () => {
    domainMock.getNotebook.mockResolvedValue(unbound as never);
    const fetchMock = vi.fn(async () => providerStream("A DH-485 link needs matching node addresses."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(chatReq({ message: "Find the manual for this Allen-Bradley SLC 5/03 on DH-485", mode: "general" }), params),
    );
    const proposal = fr.find((f) => f.kind === "identity_proposal");
    expect(proposal).toEqual({ kind: "identity_proposal", manufacturer: "Allen-Bradley", model: "SLC 5/03" });
    expect(systemPromptOf(fetchMock)).toContain("UNCONFIRMED MACHINE");
    expect(systemPromptOf(fetchMock)).toContain("Allen-Bradley SLC 5/03");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    const p = packetOf();
    // Content-free packet: the model is a hash, never text (Codex #4120 r3 F5).
    expect(p.identity.proposal).toEqual({
      manufacturer: "Allen-Bradley",
      model_sha256: "b217f051d1e3a5ff26ec33794df34402b690bc6dca1ff40cc4d34ffe191553a3",
    });
    expect(JSON.stringify(p)).not.toContain("SLC 5/03");
    // The proposal alone never changes this turn's retrieval.
    expect(p.retrieval.strategy).toBe("skipped_general_mode");
    expect(ragMock.retrieveManualChunks).not.toHaveBeenCalled();
    expect(domainMock.getNotebook).toHaveBeenCalled();
  });

  it("control: a teaching question → no frame, no packet proposal, prompt unchanged", async () => {
    domainMock.getNotebook.mockResolvedValue(unbound as never);
    const fetchMock = vi.fn(async () => providerStream("A VFD varies frequency."));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(await POST(chatReq({ message: "how does a VFD work in general", mode: "general" }), params));
    expect(fr.some((f) => f.kind === "identity_proposal")).toBe(false);
    expect(systemPromptOf(fetchMock)).not.toContain("UNCONFIRMED MACHINE");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().identity.proposal).toBeNull();
  });

  it("Codex #4120 F4: the proposal is persisted with the turn's evidence", async () => {
    domainMock.getNotebook.mockResolvedValue(unbound as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("ok")));
    await (await POST(chatReq({ message: "Find the manual for this Allen-Bradley SLC 5/03", mode: "general" }), params)).text();
    await vi.waitFor(() => expect(domainMock.recordTurn).toHaveBeenCalled());
    const rec = (domainMock.recordTurn.mock.calls.at(-1) as unknown[])[2] as { evidence: unknown[] };
    expect(rec.evidence).toContainEqual({ kind: "identity_proposal", manufacturer: "Allen-Bradley", model: "SLC 5/03" });
  });

  it("Codex #4120 F4: an idempotent replay re-emits the stored proposal and runs nothing", async () => {
    domainMock.claimNotebookTurnRequest.mockResolvedValueOnce({
      status: "replay",
      turn: {
        id: "turn-1",
        question: "Find the manual for this Allen-Bradley SLC 5/03",
        answerStatus: "answered",
        answerText: "General help.",
        enabledSourceDocIds: [],
        evidence: [{ kind: "identity_proposal", manufacturer: "Allen-Bradley", model: "SLC 5/03" }],
        model: null,
        basis: null,
      },
    } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(
      chatReq({
        message: "Find the manual for this Allen-Bradley SLC 5/03",
        mode: "general",
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      params,
    );
    expect(res.headers.get("X-Idempotent-Replay")).toBe("true");
    const fr = await frames(res);
    expect(fr.find((f) => f.kind === "identity_proposal")).toEqual({
      kind: "identity_proposal",
      manufacturer: "Allen-Bradley",
      model: "SLC 5/03",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Codex #4120 F3: a notebook bound to an asset (no identity strings) never gets a proposal", async () => {
    domainMock.getNotebook.mockResolvedValue(unbound as never);
    domainMock.resolveBoundAsset.mockResolvedValueOnce({
      state: "resolved",
      entityId: "44444444-4444-4444-8444-444444444444",
      unsPath: "enterprise.site.area.line.cv_101",
    } as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("ok")));
    const fr = await frames(
      await POST(chatReq({ message: "Find the manual for this Allen-Bradley SLC 5/03", mode: "general" }), params),
    );
    expect(fr.some((f) => f.kind === "identity_proposal")).toBe(false);
  });

  it("Codex #4120 F3: fail closed when the notebook could not be loaded", async () => {
    domainMock.getNotebook.mockResolvedValue(null as never);
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("ok")));
    const fr = await frames(
      await POST(chatReq({ message: "Find the manual for this Allen-Bradley SLC 5/03", mode: "general" }), params),
    );
    expect(fr.some((f) => f.kind === "identity_proposal")).toBe(false);
  });

  it("control: a notebook already bound to a machine never gets a proposal", async () => {
    domainMock.getNotebook.mockResolvedValue({ ...unbound, manufacturer: "Siemens", model: "TP700 Comfort" } as never);
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    const fetchMock = vi.fn(async () => providerStream("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const fr = await frames(
      await POST(chatReq({ message: "how does the Allen-Bradley SLC 5/03 compare, conceptually", mode: "general" }), params),
    );
    expect(fr.some((f) => f.kind === "identity_proposal")).toBe(false);
  });
});

describe("#4075 — a confirmed identity with no manual starts, and then reports, the official-manual search", () => {
  const confirmed = (extra: Record<string, unknown> = {}) => ({
    id: NB,
    displayName: "SMC VQ1000-FPG-C6C6-D",
    manufacturer: "Siemens",
    model: "TP700 Comfort",
    catalogNumber: null,
    identityStatus: "user_confirmed",
    nodeId: "n1",
    ...extra,
  });
  const KEY = "SIEMENS|TP700COMFORT|";
  const packetOf = () => (persistMock.persistTurnUsage.mock.calls[0] as unknown as [unknown, unknown, TurnRecord])[2].packet;
  const ask = async () => {
    ragMock.retrieveManualChunks.mockResolvedValueOnce([] as never);
    vi.stubGlobal("fetch", vi.fn());
    return frames(await POST(chatReq({ message: "it keeps rebooting, what do I check first", mode: "general" }), params));
  };

  it("never searched → starts the search once, says it is looking, and records it in the packet", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue(null);
    acqMock.startManualAcquisition.mockResolvedValue(true);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    const arg = (acqMock.startManualAcquisition.mock.calls[0] as unknown[])[0] as {
      notebookId: string;
      nodeId: string;
      identity: { manufacturer: string; model: string; identityStatus: string };
    };
    expect(arg.notebookId).toBe(NB);
    expect(arg.nodeId).toBe("n1");
    expect(arg.identity).toMatchObject({ manufacturer: "Siemens", model: "TP700 Comfort", identityStatus: "user_confirmed" });
    const status = fr.find((f) => f.kind === "status");
    expect(status?.status).toBe("insufficient_evidence");
    expect(String(status?.message)).toContain("looking for the official one now");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.manual_acquisition).toEqual({ state: "running", started_this_turn: true, candidate_host: null });
  });

  it("an earlier search left a candidate → says so (with its host), turned off until checked, and does not search again", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue({
      key: KEY,
      state: "candidate_review",
      started_at: "2026-09-29T07:00:00Z",
      finished_at: "2026-09-29T07:00:40Z",
      candidate_host: "www.smcworld.com",
      match_state: "candidate",
      oem_request_url: null,
      attached_indexed: true,
    });
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    const msg = String(fr.find((f) => f.kind === "status")?.message);
    expect(msg).toContain("possible manual");
    expect(msg).toContain("www.smcworld.com");
    expect(msg).toContain("isn't turned on");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.manual_acquisition).toEqual({
      state: "candidate_review",
      started_this_turn: false,
      candidate_host: "www.smcworld.com",
    });
  });

  it("a search recorded for a DIFFERENT identity (the notebook was re-bound) is not reported; a new one starts", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue({
      key: "SMC|VQ1000FPGC6C6D|",
      state: "no_manual_found",
      started_at: null,
      finished_at: null,
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
    });
    acqMock.startManualAcquisition.mockResolvedValue(true);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(String(fr.find((f) => f.kind === "status")?.message)).not.toContain("couldn't find one");
  });

  it("Codex #4118 r8 F13: a finished record is reconciled first — a removed source is never reported as in Sources", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    const rec = {
      key: KEY,
      state: "complete",
      started_at: null,
      finished_at: null,
      candidate_host: "www.smcworld.com",
      match_state: "verified",
      oem_request_url: null,
      attached_indexed: true,
      doc_id: "d1",
    };
    acqMock.readAcquisition.mockResolvedValue(rec);
    acqMock.reconcileAcquisition.mockImplementationOnce(async () => ({ ...rec, attached_indexed: false, source_removed: true }));
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.reconcileAcquisition).toHaveBeenCalledWith(expect.any(String), NB, rec);
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    const msg = String(fr.find((f) => f.kind === "status")?.message);
    expect(msg).toContain("no longer in this notebook's Sources");
    expect(msg).not.toContain("turn it on in Sources");
  });

  it("Codex #4118 r7 F12: a matching 'search_unavailable' record goes back through the claim (retried after its backoff)", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue({
      key: KEY,
      state: "search_unavailable",
      started_at: null,
      finished_at: "2026-09-29T06:00:00Z",
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
    });
    acqMock.startManualAcquisition.mockResolvedValue(true);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(String(fr.find((f) => f.kind === "status")?.message)).toContain("looking for the official one now");
  });

  it("Codex #4118 r14 F19: a retryable record whose manual the technician removed is NOT retried", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    const rec = {
      key: KEY,
      state: "search_unavailable",
      started_at: null,
      finished_at: "2026-09-29T06:00:00Z",
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
      doc_id: "d1",
      linked: true,
    };
    acqMock.readAcquisition.mockResolvedValue(rec);
    // Once for the pre-retry check, once for the reply text — never leaks.
    acqMock.reconcileAcquisition
      .mockImplementationOnce(async () => ({ ...rec, source_removed: true }))
      .mockImplementationOnce(async () => ({ ...rec, source_removed: true }));
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(String(fr.find((f) => f.kind === "status")?.message)).toContain("no longer in this notebook's Sources");
  });

  it("Codex #4118 F1: a matching 'running' record goes back through the claim (which recovers a stale one)", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue({
      key: KEY,
      state: "running",
      started_at: "2026-09-29T06:00:00Z",
      finished_at: null,
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
    });
    acqMock.startManualAcquisition.mockResolvedValue(true);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).toHaveBeenCalledTimes(1);
    expect(String(fr.find((f) => f.kind === "status")?.message)).toContain("looking for the official one now");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.manual_acquisition).toMatchObject({ state: "running", started_this_turn: true });
  });

  it("control: a live 'running' claim refuses the restart and the turn still says it is looking", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue({
      key: KEY,
      state: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      candidate_host: null,
      match_state: null,
      oem_request_url: null,
    });
    acqMock.startManualAcquisition.mockResolvedValue(false);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(String(fr.find((f) => f.kind === "status")?.message)).toContain("looking for the official one now");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.manual_acquisition).toMatchObject({ state: "running", started_this_turn: false });
  });

  it("control: feature off → the #4068 decline is unchanged and nothing is started", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(false);
    domainMock.getNotebook.mockResolvedValue(confirmed() as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(acqMock.readAcquisition).not.toHaveBeenCalled();
    const msg = String(fr.find((f) => f.kind === "status")?.message);
    expect(msg).toContain("Siemens TP700 Comfort manuals");
    expect(msg).toContain("won't guess");
    await vi.waitFor(() => expect(persistMock.persistTurnUsage).toHaveBeenCalledTimes(1));
    expect(packetOf().retrieval.manual_acquisition).toBeNull();
  });

  it("control: an identity the technician did NOT confirm never starts a search", async () => {
    acqMock.acquisitionEnabled.mockReturnValue(true);
    acqMock.readAcquisition.mockResolvedValue(null);
    domainMock.getNotebook.mockResolvedValue(confirmed({ identityStatus: "candidate" }) as never);
    const fr = await ask();
    expect(acqMock.startManualAcquisition).not.toHaveBeenCalled();
    expect(String(fr.find((f) => f.kind === "status")?.message)).toContain("won't guess");
  });
});
