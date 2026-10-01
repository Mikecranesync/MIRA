/**
 * Codex #4194 r1–r3 — every manual acquisition must reach the flight recorder
 * under the PRODUCTION sampler (turnOnlySampler, installed by
 * instrumentation.node.ts), not just under the unsampled in-memory test
 * provider. Exactly one `manual_acquisition.run` root per acquisition, made by
 * the REAL acquireManualForIdentity (only its leaf I/O is mocked):
 *   - started by a chat turn → linked to that turn, and follows ITS decision
 *     (a dropped turn is never resampled), at any ratio;
 *   - standalone (nameplate confirm, its direct component search, notebook
 *     create) → its own root, sampled at the turn ratio, never a child of the
 *     framework request span the sampler drops.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceFlags, trace } from "@opentelemetry/api";
import type { SpanContext } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MiraAttributeProcessor, TRACER_NAME } from "@/capabilities/observability/tracing";
import { turnOnlySampler } from "@/capabilities/observability/turn-sampler";

vi.mock("@/lib/manual-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-discovery")>()),
  // A quick, realistic "nothing found" — the search stage still runs and spans.
  discoverManual: vi.fn(async () => ({
    serviceAvailable: true,
    found: false,
    candidate: null,
    validated: false,
    isDirectPdf: false,
    oemHost: false,
    trustedDistributorHost: false,
    reason: "no official manual found",
    oemRequestUrl: null,
    quotaExceeded: false,
    searchStats: { providerQueries: 2, refusedQueries: 0, quotaDenied: null, candidates: 0 },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) =>
        /RETURNING manual_acquisition->>'gen'/.test(sql) ? { rowCount: 1, rows: [{ gen: "g1" }] } : { rowCount: 1, rows: [] },
      ),
    }),
  ),
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-files")>()),
  attachFileToTargetsTx: vi.fn(async () => ({ ok: true, links: [] })),
}));

import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";
import { runManualAcquisition, startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";

const identity = { manufacturer: "M", model: "TEST-123" };
const direct = { tenantId: "t", userId: "u", notebookId: "nb", nodeId: "node", identity };
const lifecycle = {
  ...direct,
  identity: { identityStatus: "user_confirmed", manufacturer: "M", model: "TEST-123", catalogNumber: null },
};
const ON = { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" };

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let ratio = 1;
beforeAll(() => {
  // The production sampler, with a ratio each test sets.
  const sampler = {
    shouldSample: (...a: Parameters<ReturnType<typeof turnOnlySampler>["shouldSample"]>) =>
      turnOnlySampler(ratio).shouldSample(...a),
    toString: () => "test",
  };
  provider = new NodeTracerProvider({
    sampler,
    spanProcessors: [new MiraAttributeProcessor(), new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});
afterAll(async () => {
  await provider.shutdown();
});
beforeEach(() => {
  exporter.reset();
  ratio = 1;
});

const tracer = () => trace.getTracer(TRACER_NAME);
const runs = () => exporter.getFinishedSpans().filter((s) => s.name === "manual_acquisition.run");
const settle = () => new Promise((r) => setTimeout(r, 30));

/** As the chat route does: a `mira.turn` started with startSpan and NEVER activated. */
function chatTurn(): { ctx: SpanContext; end: () => void } {
  const span = tracer().startSpan("mira.turn", { root: true });
  return { ctx: span.spanContext(), end: () => span.end() };
}

/** A framework request span (Next.js `POST`) — dropped by the turn-only sampler. */
async function underDroppedRequestSpan(fn: () => Promise<unknown>) {
  await tracer().startActiveSpan("POST", { root: true }, async (span) => {
    expect(span.isRecording()).toBe(false);
    await fn();
    span.end();
  });
}

describe("chat-started acquisitions follow their turn", () => {
  it("a kept turn: one run root, linked to that turn, with its stage children", async () => {
    const turn = chatTurn();
    expect(await startManualAcquisition({ ...lifecycle, turnSpanContext: turn.ctx }, { env: ON })).toBe(true);
    turn.end();
    await vi.waitFor(() => expect(runs()).toHaveLength(1));
    const run = runs()[0];
    expect(run.links[0].context.traceId).toBe(turn.ctx.traceId);
    expect(run.links[0].context.spanId).toBe(turn.ctx.spanId);
    expect(run.attributes["mira.acquisition.started_this_turn"]).toBe(true);
    expect(run.attributes["mira.acquisition.outcome"]).toBe("no_manual_found");
    const search = exporter.getFinishedSpans().find((s) => s.name === "manual_acquisition.search")!;
    expect(search.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
  });

  it("a DROPPED turn is never resampled, even at ratio 1", async () => {
    const dropped = { traceId: "2af7651916cd43dd8448eb211c80319c", spanId: "d7ad6b7169203331", traceFlags: TraceFlags.NONE };
    await acquireManualForIdentity({ ...direct, turnSpanContext: dropped });
    await settle();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("fractional ratio: the run follows its turn's decision, not its own trace id", async () => {
    ratio = 0.5;
    const kept = { traceId: "3af7651916cd43dd8448eb211c80319c", spanId: "e7ad6b7169203331", traceFlags: TraceFlags.SAMPLED };
    const dropped = { ...kept, traceFlags: TraceFlags.NONE };
    for (let i = 0; i < 12; i++) await acquireManualForIdentity({ ...direct, turnSpanContext: kept });
    expect(runs()).toHaveLength(12);
    exporter.reset();
    for (let i = 0; i < 12; i++) await acquireManualForIdentity({ ...direct, turnSpanContext: dropped });
    expect(runs()).toHaveLength(0);
  });
});

describe("standalone acquisitions are units of work of their own", () => {
  it("direct pipeline call (nameplate confirm component search): one run root + children", async () => {
    await underDroppedRequestSpan(() => acquireManualForIdentity(direct));
    expect(runs()).toHaveLength(1);
    expect(runs()[0].attributes["mira.acquisition.started_this_turn"]).toBe(false);
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain("manual_acquisition.search");
    expect(exporter.getFinishedSpans().map((s) => s.name)).not.toContain("POST");
  });

  it("inline lifecycle run (nameplate confirm, own identity): exactly one run root", async () => {
    await underDroppedRequestSpan(() => runManualAcquisition(direct, { env: ON }));
    expect(runs()).toHaveLength(1);
  });

  it("background lifecycle run (notebook create): exactly one run root", async () => {
    await underDroppedRequestSpan(() => startManualAcquisition(lifecycle, { env: ON }));
    await vi.waitFor(() => expect(runs()).toHaveLength(1));
    await settle();
    expect(runs()).toHaveLength(1);
  });

  it("ratio 0 drops standalone runs too", async () => {
    ratio = 0;
    await underDroppedRequestSpan(() => acquireManualForIdentity(direct));
    await underDroppedRequestSpan(() => runManualAcquisition(direct, { env: ON }));
    await settle();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
