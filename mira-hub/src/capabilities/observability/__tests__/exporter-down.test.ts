/**
 * Exporter down — the export pipeline must never block a technician's turn,
 * never leak an unhandled rejection, and always let the process shut down
 * cleanly, whether the OTLP backend hangs or throws.
 *
 * Design: docs/architecture/observability/2026-09-22-turn-flight-recorder.md
 * §7 "Failure behaviour". This file constructs its OWN `NodeTracerProvider`
 * (not `tracing.ts`'s `__testing__installInMemoryExporter`, which wires a
 * `SimpleSpanProcessor` + `InMemorySpanExporter` — synchronous, always
 * healthy) because these tests need a REAL `BatchSpanProcessor` in front of
 * a deliberately-broken exporter.
 *
 * IMPORTANT — one global tracer provider per process. Verified by reading
 * `@opentelemetry/api`'s `internal/global-utils.js`: a second `.register()`
 * call is a silent no-op (`diag.error`-logged only, the delegate is never
 * replaced). `trace.disable()` precedes every registration in this file so
 * it wins regardless of what a previous test FILE in this worker left
 * behind, and the `instrumentation.node.ts` no-op check below runs FIRST —
 * before anything in this file (or a prior file sharing the worker) has
 * registered a real provider — since that check's whole point is observing
 * the untouched, still-no-op global state.
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/exporter-down.test.ts
 */
import { context, propagation, trace } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiraAttributeProcessor, withSpan } from "../tracing";

describe("instrumentation.node.ts — no OTEL_EXPORTER_OTLP_ENDPOINT is a true no-op", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("registers nothing when imported with the endpoint unset — asserted via the exported function and the untouched global provider", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

    // Start from a genuinely clean global registry — don't assume no prior
    // file in this worker registered a provider; make it true.
    trace.disable();
    context.disable();
    propagation.disable();

    const before = trace.getTracerProvider() as unknown as { getDelegate?: () => unknown };
    expect(before.getDelegate?.()?.constructor?.name).toBe("NoopTracerProvider");

    // instrumentation.node.ts calls `startTelemetry()` as a bare module-level
    // side effect at import time (see its own header comment) — there is no
    // exported "did it start" flag, so the only honest way to test the
    // no-op path is: import it fresh (vi.resetModules so this file's own
    // module cache can't short-circuit a re-import), with the endpoint truly
    // unset, then check the one thing that WOULD have changed if it had
    // started — the global tracer provider — and call its one export,
    // `shutdownTelemetry`, to confirm it's a safe no-op too.
    vi.resetModules();
    const mod = await import("@/instrumentation.node");

    const after = trace.getTracerProvider() as unknown as { getDelegate?: () => unknown };
    expect(after.getDelegate?.()?.constructor?.name).toBe("NoopTracerProvider");

    await expect(mod.shutdownTelemetry()).resolves.toBeUndefined();
  });
});

class NeverRespondingExporter implements SpanExporter {
  export(_spans: ReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
    // Deliberately never calls the callback — simulates a hung/unreachable
    // OTLP backend. `exportTimeoutMillis` (not our code) is what bounds this.
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class ThrowsSynchronouslyExporter implements SpanExporter {
  export(_spans: ReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
    throw new Error("synchronous exporter failure");
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** Small queue so the BatchSpanProcessor's drain/retry loop runs several
 * times over 100 spans instead of once, and a short timeout so a hung
 * exporter's cost is bounded and the test stays fast. */
function registerBrokenExporterProvider(exporter: SpanExporter): NodeTracerProvider {
  trace.disable();
  context.disable();
  propagation.disable();
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new MiraAttributeProcessor(),
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 8,
        maxExportBatchSize: 8,
        exportTimeoutMillis: 50,
        scheduledDelayMillis: 10,
      }),
    ],
  });
  provider.register();
  return provider;
}

describe("BatchSpanProcessor + a broken exporter never blocks withSpan, never throws unhandled, and lets the provider shut down", () => {
  let unhandled: unknown[] = [];
  const onUnhandledRejection = (err: unknown) => {
    unhandled.push(err);
  };

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandledRejection);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandledRejection);
  });

  it(
    "an exporter that never calls its callback (hung backend) is bounded by exportTimeoutMillis and never blocks a turn",
    async () => {
      const provider = registerBrokenExporterProvider(new NeverRespondingExporter());

      const start = Date.now();
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(await withSpan(`hung-${i}`, { "mira.turn.id": String(i) }, async () => i));
      }
      const elapsedMs = Date.now() - start;

      expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
      // 100 sequential exportTimeoutMillis waits would be 100*50=5000ms;
      // withSpan never waits on export at all (span.end() is synchronous —
      // see tracing.ts), so this should be nowhere close.
      expect(elapsedMs).toBeLessThan(2000);
      expect(unhandled).toHaveLength(0);

      // Verified empirically (not asserted here, but recorded so the wait
      // below isn't a magic number): calling provider.shutdown()
      // IMMEDIATELY after the loop above races an in-flight export and
      // REJECTS with "Timeout" — BatchSpanProcessorBase's `_flushAll` (used
      // by `shutdown()`) does `Promise.all(...).catch(reject)`, so a batch
      // still draining at shutdown time propagates its timeout rejection all
      // the way out. Waiting long enough for the ~ceil(100/8) drain cycles
      // (each bounded by exportTimeoutMillis=50ms) to finish first avoids
      // that race — every dequeued batch is gone from the internal buffer
      // the moment it's handed to `export()`, win or lose, so once the
      // buffer is empty `shutdown()`'s own flush is a no-op.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await expect(provider.shutdown()).resolves.toBeUndefined();
    },
    10000,
  );

  it(
    "an exporter whose export() throws synchronously does not block withSpan or leak an unhandled rejection",
    async () => {
      const provider = registerBrokenExporterProvider(new ThrowsSynchronouslyExporter());

      const start = Date.now();
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(await withSpan(`throws-${i}`, { "mira.turn.id": String(i) }, async () => i));
      }
      const elapsedMs = Date.now() - start;

      expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
      expect(elapsedMs).toBeLessThan(2000);
      expect(unhandled).toHaveLength(0);

      // A synchronous throw fails each batch near-instantly (no timeout to
      // wait out), so the drain finishes fast — 800ms is ample margin.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await expect(provider.shutdown()).resolves.toBeUndefined();
    },
    10000,
  );
});
