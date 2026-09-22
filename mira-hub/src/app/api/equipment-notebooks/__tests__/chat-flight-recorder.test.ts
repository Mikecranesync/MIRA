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
  appendManualContext: vi.fn((base: string) => base),
  buildManualUserContent: vi.fn((q: string) => q),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

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
  renderLookObservationSection: vi.fn((row: unknown) => (row ? "## LOOK-CTX" : "")),
  normalizeLookHazards: vi.fn(() => []),
  recordLookObservation: vi.fn(async () => ({})),
}));
vi.mock("@/lib/visual-evidence-context", () => veMock);

import { POST } from "../[id]/chat/route";

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
