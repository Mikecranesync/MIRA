/**
 * safeSpan — fail-open span wrapper for the manual-acquisition span tree
 * (#4160 gate R15, PRD v1.7.1 R15: "The Turn Flight Recorder gets an
 * acquisition span tree covering recall hit, search, download, ingest,
 * applicability verdict, cap hits and cost").
 *
 * A NEW, small module on purpose (not a new export on
 * `@/capabilities/manual-acquisition` or `@/capabilities/notebook-manual-acquisition`):
 * several existing test suites mock those two capabilities with an EXPLICIT
 * export list (e.g. `vi.mock("@/capabilities/manual-acquisition", () => ({
 * acquireManualForIdentity: vi.fn() }))` in notebook-manual-acquisition.test.ts)
 * — a new named export added to either of those modules would come back
 * `undefined` under those mocks and throw at runtime the moment the real
 * acquisition pipeline (which those tests DO exercise, via `acquire` deps
 * overrides) tried to call it. This module is never mocked by any existing
 * test, so both capabilities can import it directly and keep working.
 *
 * Tracing must never change behaviour: every OTel call below is individually
 * guarded, so a throwing tracer or exporter can delay nothing and alter
 * nothing about `fn`'s outcome — `fn`'s return value or thrown business
 * error always wins over a tracing-layer failure.
 */
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { addSpanLink, getTracer, setSpanAttrs } from "@/capabilities/observability/tracing";
import type { SpanAttrs } from "@/capabilities/observability/tracing";

export interface SpanLink {
  traceId: string;
  spanId: string;
}

export interface SafeSpanOptions {
  /**
   * Start a NEW trace, ignoring whatever span is currently active. Used for
   * the detached background acquisition run, which must not be nested
   * under the HTTP turn that started it (that turn's span may already have
   * ended by the time this one does) — see `link` instead.
   */
  root?: boolean;
  /** A span link to another trace (e.g. the turn that started a detached run). */
  link?: SpanLink;
}

function logTracingError(name: string, stage: string, err: unknown): void {
  console.error(`[acquisition-spans] ${stage} failed (${name}):`, err instanceof Error ? err.message : err);
}

/**
 * Run `fn` inside a new active child span named `name`, with `attrs` set at
 * start. Any span created by `fn` itself (via another `safeSpan` call, or
 * `withSpan` from tracing.ts) nests under this one through the normal OTel
 * active-context propagation.
 *
 * Fail-open guarantee: if the tracer throws BEFORE `fn` is ever invoked
 * (e.g. `getTracer()`/`startActiveSpan` itself is broken), `fn` still runs,
 * exactly once, untraced. If `fn` throws a real business error, that error
 * propagates unchanged. If span bookkeeping (`setSpanAttrs`, `addSpanLink`,
 * `span.end()`) throws, it is logged and swallowed — it can never replace
 * `fn`'s return value or error.
 */
export async function safeSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: () => Promise<T>,
  opts: SafeSpanOptions = {},
): Promise<T> {
  let entered = false;
  try {
    return await getTracer().startActiveSpan(name, opts.root ? { root: true } : {}, async (span) => {
      entered = true;
      try {
        setSpanAttrs(attrs, span);
      } catch (err) {
        logTracingError(name, "setSpanAttrs", err);
      }
      if (opts.link) {
        try {
          addSpanLink(opts.link.traceId, opts.link.spanId);
        } catch (err) {
          logTracingError(name, "addSpanLink", err);
        }
      }
      try {
        return await fn();
      } catch (fnErr) {
        try {
          const error = fnErr instanceof Error ? fnErr : new Error(String(fnErr));
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        } catch (err) {
          logTracingError(name, "recordException", err);
        }
        throw fnErr;
      } finally {
        try {
          span.end();
        } catch (err) {
          logTracingError(name, "span.end", err);
        }
      }
    });
  } catch (err) {
    // `entered` distinguishes a real business error (fn already ran and threw
    // — rethrow it unchanged) from the tracer itself failing before fn was
    // ever called (fall back to running fn untraced, exactly once).
    if (entered) throw err;
    logTracingError(name, "startActiveSpan", err);
    return fn();
  }
}

/** Set attributes on the span `safeSpan` most recently activated, fail-open. */
export function setActiveSpanAttrs(attrs: SpanAttrs): void {
  try {
    const span = trace.getActiveSpan();
    if (span) setSpanAttrs(attrs, span);
  } catch (err) {
    logTracingError("active", "setSpanAttrs", err);
  }
}
