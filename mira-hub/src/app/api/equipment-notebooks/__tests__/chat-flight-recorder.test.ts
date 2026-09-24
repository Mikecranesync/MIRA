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
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
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

describe("recordTurn throwing still persists a packet", () => {
  it("persistence.outcome is 'failed'", async () => {
    domainMock.recordTurn.mockRejectedValueOnce(new Error("write unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => providerStream("General guidance.")));
    const res = await POST(
      chatReq({ message: "q", mode: "general", clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
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

  it("4a. the newest recalled photo alone selects OEM identity when an older photo is a different model", async () => {
    const olderFile = "55555555-5555-4555-8555-555555555555";
    domainMock.getNotebook.mockResolvedValue(nb() as never);
    domainMock.listTurns.mockResolvedValueOnce([
      { id: "old", threadId: "th", evidence: [{ kind: "visual_observation", fileId: olderFile, capturedAt: "2026-09-22T04:00:00Z", provenance: "phone_photo" }] },
      { id: "new", threadId: "th", evidence: [{ kind: "visual_observation", fileId: FILE_ID, capturedAt: "2026-09-22T05:00:00Z", provenance: "phone_photo" }] },
    ] as never);
    veMock.loadVisualEvidenceForPhoto
      .mockResolvedValueOnce({ text: "Siemens SINAMICS V20 drive", fileId: FILE_ID } as never)
      .mockResolvedValueOnce({ text: "Siemens TP700 Comfort panel", fileId: olderFile } as never);
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
