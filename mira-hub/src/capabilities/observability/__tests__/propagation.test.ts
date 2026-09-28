/**
 * Propagation — trace context survives every async hop shape the route code
 * actually uses (an awaited call, a setTimeout hop, a Promise.all fan-out, a
 * ReadableStream's `start()` callback re-entered via `context.with`, and
 * nested `withSpan` calls), and the SDK's default propagator can extract a
 * real inbound W3C `traceparent` header — documenting readiness for the
 * mobile client-traceparent follow-up (design §1, §9).
 *
 * Run: npx vitest run src/capabilities/observability/__tests__/propagation.test.ts
 */
import { context, defaultTextMapGetter, propagation, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { __testing__installInMemoryExporter, activeTraceId, withSpan } from "../tracing";

// See redaction.test.ts's header comment for why this disable/install/disable
// dance is required: @opentelemetry/api's global registry is process-wide
// (globalThis, not per-module-instance), so a prior test FILE sharing this
// worker could otherwise leave a competing provider registered, and a
// second `.register()` call is a silent no-op.
let handle: ReturnType<typeof __testing__installInMemoryExporter>;

beforeAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
  handle = __testing__installInMemoryExporter();
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

beforeEach(() => {
  handle.reset();
});

function finished(): ReadableSpan[] {
  return handle.finished();
}

describe("trace id survives every async hop shape a route uses", () => {
  it("survives an awaited hop", async () => {
    await withSpan("await-outer", {}, async () => {
      const outer = activeTraceId();
      expect(outer).toMatch(/^[0-9a-f]{32}$/);
      await Promise.resolve();
      expect(activeTraceId()).toBe(outer);
    });
  });

  it("survives a setTimeout hop", async () => {
    await withSpan("timeout-outer", {}, async () => {
      const outer = activeTraceId();
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      expect(activeTraceId()).toBe(outer);
    });
  });

  it("survives a Promise.all fan-out — every branch sees the same trace id", async () => {
    await withSpan("fanout-outer", {}, async () => {
      const outer = activeTraceId();
      const results = await Promise.all(
        [0, 1, 2].map(async (i) => {
          await new Promise((resolve) => setTimeout(resolve, i));
          return activeTraceId();
        }),
      );
      expect(results).toEqual([outer, outer, outer]);
    });
  });

  it("survives a ReadableStream start() callback re-entered via context.with(captured) — the SSE-route pattern", async () => {
    let observedInStream: string | null = null;
    await withSpan("stream-outer", {}, async () => {
      const outer = activeTraceId();
      // This is the pattern SSE route code needs: capture the active
      // context BEFORE handing control to the stream (the platform invokes
      // `start()` on its own microtask, detached from this call site's
      // context), then explicitly re-enter it.
      const captured = context.active();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          context.with(captured, () => {
            observedInStream = activeTraceId();
            controller.close();
          });
        },
      });
      const reader = stream.getReader();
      await reader.read();
      expect(observedInStream).toBe(outer);
    });
  });

  it("nested withSpan three levels deep chains parent/child span ids correctly", async () => {
    await withSpan("level-1", {}, async () => {
      await withSpan("level-2", {}, async () => {
        await withSpan("level-3", {}, async () => {});
      });
    });

    const spans = finished();
    const l1 = spans.find((s) => s.name === "level-1");
    const l2 = spans.find((s) => s.name === "level-2");
    const l3 = spans.find((s) => s.name === "level-3");
    expect(l1).toBeDefined();
    expect(l2).toBeDefined();
    expect(l3).toBeDefined();

    expect(l2?.parentSpanContext?.spanId).toBe(l1?.spanContext().spanId);
    expect(l3?.parentSpanContext?.spanId).toBe(l2?.spanContext().spanId);
    expect(l1?.spanContext().traceId).toBe(l2?.spanContext().traceId);
    expect(l2?.spanContext().traceId).toBe(l3?.spanContext().traceId);
  });
});

describe("inbound W3C traceparent — the SDK's default propagator", () => {
  // `NodeTracerProvider.register()` with no `propagator` option installs
  // `CompositePropagator([W3CTraceContextPropagator, W3CBaggagePropagator])`
  // as the global propagator (verified by reading
  // `@opentelemetry/sdk-trace-node`'s `NodeTracerProvider.js`
  // `setupPropagator`) — i.e. exactly what `instrumentation.node.ts`'s real
  // `NodeSDK` bootstrap gets by default. So `propagation.extract` here,
  // against the SAME registration path `__testing__installInMemoryExporter`
  // uses, genuinely exercises "the SDK's default propagator", not a
  // hand-picked one this test constructs.
  it("propagation.extract on a headers carrier yields a span whose traceId equals the header's traceId", async () => {
    // W3C Trace Context spec's own example header.
    const headerTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const headerSpanId = "00f067aa0ba902b7";
    const carrier = { traceparent: `00-${headerTraceId}-${headerSpanId}-01` };

    const extracted = propagation.extract(context.active(), carrier, defaultTextMapGetter);

    let sawTraceId: string | null = null;
    await context.with(extracted, async () => {
      await withSpan("inbound-child", {}, async () => {
        sawTraceId = activeTraceId();
      });
    });

    expect(sawTraceId).toBe(headerTraceId);

    const span = finished().find((s) => s.name === "inbound-child");
    expect(span).toBeDefined();
    expect(span?.spanContext().traceId).toBe(headerTraceId);
    // The extracted remote span context becomes this span's PARENT — proving
    // the inbound header, not just its trace id, actually threads through.
    expect(span?.parentSpanContext?.spanId).toBe(headerSpanId);
    expect(span?.parentSpanContext?.isRemote).toBe(true);
  });
});
