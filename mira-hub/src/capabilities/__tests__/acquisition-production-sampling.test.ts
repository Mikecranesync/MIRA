/**
 * Codex #4194 F1 — the background acquisition tree must survive the
 * PRODUCTION sampler (turnOnlySampler, installed by instrumentation.node.ts),
 * not just the unsampled in-memory test provider. A detached
 * `manual_acquisition.run` root is kept when the chat turn that started it
 * was kept, and dropped with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MiraAttributeProcessor, TRACER_NAME } from "@/capabilities/observability/tracing";
import { turnOnlySampler } from "@/capabilities/observability/turn-sampler";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) =>
        /RETURNING manual_acquisition->>'gen'/.test(sql) ? { rowCount: 1, rows: [{ gen: "g1" }] } : { rowCount: 1, rows: [] },
      ),
    }),
  ),
}));
vi.mock("@/lib/workspace-files", () => ({ attachFileToTargetsTx: vi.fn(async () => ({ ok: true, links: [] })) }));
vi.mock("@/capabilities/manual-acquisition", () => ({ acquireManualForIdentity: vi.fn() }));

import { runManualAcquisition, startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";
import { safeSpan } from "@/capabilities/observability/acquisition-spans";

const input = {
  tenantId: "t",
  userId: "u",
  notebookId: "nb",
  nodeId: "node",
  identity: { identityStatus: "user_confirmed", manufacturer: "M", model: "TEST-123", catalogNumber: null },
};
const ON = { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" };

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let ratio = 1;
beforeAll(() => {
  // The production sampler, with a ratio this suite can flip per test.
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
beforeEach(() => exporter.reset());

// A child span inside the run, as the real pipeline opens (recall/search/…).
const acquire = vi.fn(async () =>
  safeSpan("manual_acquisition.search", {}, async () => ({ status: "no_manual_found" as const, payload: {} })),
);

async function turnStartingAcquisition() {
  await trace.getTracer(TRACER_NAME).startActiveSpan("mira.turn", { root: true }, async (span) => {
    await startManualAcquisition(input, { acquire, env: ON });
    span.end();
  });
}

describe("background acquisition under the production sampler", () => {
  it("a kept turn keeps its linked acquisition root AND that root's children", async () => {
    ratio = 1;
    await turnStartingAcquisition();
    await vi.waitFor(() => {
      expect(exporter.getFinishedSpans().some((s) => s.name === "manual_acquisition.run")).toBe(true);
    });
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain("mira.turn");
    expect(names).toContain("manual_acquisition.search");
    const run = exporter.getFinishedSpans().find((s) => s.name === "manual_acquisition.run")!;
    const turn = exporter.getFinishedSpans().find((s) => s.name === "mira.turn")!;
    expect(run.links[0].context.traceId).toBe(turn.spanContext().traceId);
  });

  it("a dropped turn (ratio 0) drops its acquisition tree too", async () => {
    ratio = 0;
    await turnStartingAcquisition();
    await new Promise((r) => setTimeout(r, 50));
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    ratio = 1;
  });

  // Codex #4194 r2 F1: the nameplate-confirm route (inline) and notebook create
  // (background) open no mira.turn — the framework request span is dropped by
  // the sampler. Their acquisitions are units of work of their own.
  async function underDroppedRequestSpan(fn: () => Promise<unknown>) {
    await trace.getTracer(TRACER_NAME).startActiveSpan("POST", { root: true }, async (span) => {
      expect(span.isRecording()).toBe(false); // the turn-only sampler drops it
      await fn();
      span.end();
    });
  }

  it("inline run outside any turn (nameplate confirm): exported with its children", async () => {
    ratio = 1;
    await underDroppedRequestSpan(() => runManualAcquisition(input, { acquire, env: ON }));
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain("manual_acquisition.run");
    expect(names).toContain("manual_acquisition.search");
    expect(names).not.toContain("POST");
  });

  it("background run outside any turn (notebook create): exported with its children", async () => {
    ratio = 1;
    await underDroppedRequestSpan(() => startManualAcquisition(input, { acquire, env: ON }));
    await vi.waitFor(() => {
      expect(exporter.getFinishedSpans().some((s) => s.name === "manual_acquisition.run")).toBe(true);
    });
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain("manual_acquisition.search");
  });

  it("standalone runs honor a zero ratio", async () => {
    ratio = 0;
    await underDroppedRequestSpan(() => runManualAcquisition(input, { acquire, env: ON }));
    await underDroppedRequestSpan(() => startManualAcquisition(input, { acquire, env: ON }));
    await new Promise((r) => setTimeout(r, 50));
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    ratio = 1;
  });
});
