/**
 * Turn Flight Recorder — tracer, attribute allowlist/redaction, and the
 * test-only in-memory exporter harness. See:
 * docs/architecture/observability/2026-09-22-turn-flight-recorder.md §3, §10 (lane I1).
 *
 * This module never throws because tracing is disabled. When no
 * TracerProvider is registered, `@opentelemetry/api` hands back a no-op
 * tracer whose spans are non-recording — `withSpan` still runs `fn` and
 * returns its result; `activeTraceId`/`activeSpanId` return null.
 */
import { SpanStatusCode, TraceFlags, trace } from "@opentelemetry/api";
import type { Attributes, AttributeValue, Span, Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan, Span as SdkSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export const TRACER_NAME = "mira-hub";

export type SpanAttrs = Record<
  string,
  string | number | boolean | string[] | number[] | null | undefined
>;

// Only these prefixes may reach an exported span. Anything else — most
// notably auto-instrumentation header capture, which we never enable, but
// also any accidental app-level attribute outside this contract — is
// dropped rather than exported. See design doc §3 "Attribute policy".
const ALLOWED_ATTRIBUTE_PREFIXES = [
  "mira.",
  "gen_ai.",
  "http.",
  "db.",
  "net.",
  "url.",
  "server.",
  "client.",
  "error.",
  "exception.",
  "next.",
];

export function isAllowedAttributeKey(key: string): boolean {
  return ALLOWED_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Key-based redaction. `token` is matched as a credential shape only — a whole
// word or a `_token` / `-token` suffix (session_token, access-token,
// x-auth-token) — never the plural `_tokens`, which is what the GenAI usage
// counters are called (gen_ai.usage.input_tokens). Those counters carried
// "[REDACTED]" to Langfuse on every generation until this was narrowed.
const SECRET_KEY_PATTERN =
  /authorization|cookie|secret|password|api[_-]?key|(?:^|[._-])token(?:$|[._-])|(?:^|[._-])tokens?[_-](?:id|value|secret)/i;
const USAGE_COUNTER_PREFIX = "gen_ai.usage.";
const SECRET_VALUE_MARKERS = [
  "Bearer ",
  "Basic ",
  "pk-lf-",
  "sk-lf-",
  "gsk_",
  "csk-",
  "session-token",
  "Cookie",
  "cookie=",
  "Authorization",
];

function valueLooksSecret(value: string): boolean {
  return SECRET_VALUE_MARKERS.some((marker) => value.includes(marker));
}

export function redactAttributeValue(key: string, value: unknown): unknown {
  if (!key.startsWith(USAGE_COUNTER_PREFIX) && SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return valueLooksSecret(value) ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAttributeValue(key, entry));
  }
  return value;
}

const MAX_STRING_LEN = 512;
const MAX_ARRAY_LEN = 32;

function clampString(value: string): string {
  return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) : value;
}

function clampValue(value: SpanAttrs[string]): AttributeValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    // An empty array reaches Langfuse as the literal `{"arrayValue":{}}` (the
    // OTLP encoding of an empty list). Omit the attribute instead; the durable
    // packet still records `[]`, and "absent" reads as empty in the viewer.
    if (value.length === 0) return undefined;
    return value
      .slice(0, MAX_ARRAY_LEN)
      .map((entry) => (typeof entry === "string" ? clampString(entry) : entry)) as AttributeValue;
  }
  if (typeof value === "string") return clampString(value);
  return value;
}

/** Allowlist + clamp + redact a caller-supplied attribute bag into a plain Attributes object. */
function sanitizeAttrs(attrs: SpanAttrs): Attributes {
  const out: Attributes = {};
  for (const [key, rawValue] of Object.entries(attrs)) {
    if (!isAllowedAttributeKey(key)) continue;
    const clamped = clampValue(rawValue);
    if (clamped === undefined) continue;
    out[key] = redactAttributeValue(key, clamped) as AttributeValue;
  }
  return out;
}

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export function setSpanAttrs(attrs: SpanAttrs, span?: Span): void {
  const target = span ?? trace.getActiveSpan();
  if (!target) return;
  target.setAttributes(sanitizeAttrs(attrs));
}

export function activeTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (!span || !span.isRecording()) return null;
  return span.spanContext().traceId;
}

export function activeSpanId(): string | null {
  const span = trace.getActiveSpan();
  if (!span || !span.isRecording()) return null;
  return span.spanContext().spanId;
}

export function addSpanLink(traceId: string, spanId: string, attrs: SpanAttrs = {}): void {
  const span = trace.getActiveSpan();
  if (!span || typeof span.addLink !== "function") return;
  span.addLink({
    context: {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    },
    attributes: sanitizeAttrs(attrs),
  });
}

/**
 * Starts an active child span of the current context, applies the
 * allowlisted attrs, and always ends the span. On throw, records the
 * exception + ERROR status and re-throws. When tracing is disabled (no
 * provider registered) `fn` still runs against a non-recording span.
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    setSpanAttrs(attrs, span);
    try {
      return await fn(span);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * SpanProcessor that enforces the attribute allowlist + redaction on EVERY
 * span that reaches the exporter.
 *
 * `onStart` only sees creation-time attributes; the SDK's `SpanImpl` calls
 * the processor exactly once at construction, and every later
 * `span.setAttribute(s)` (which is how http/pg/undici auto-instrumentation
 * attaches most of its attributes, and how a caller could bypass
 * `setSpanAttrs`) writes straight into the span with no processor hook. So
 * the real enforcement point is `onEnd`: the `ReadableSpan.attributes`
 * object the SDK hands us is the span's own (mutable) attribute map, and
 * this processor is registered BEFORE the batch processor, so scrubbing it
 * in place here is what the exporter sees. `scrubInPlace` is exported for
 * tests so the guarantee can be asserted on a finished span, not inferred.
 */
export function scrubInPlace(attrs: Record<string, unknown>): void {
  for (const key of Object.keys(attrs)) {
    if (!isAllowedAttributeKey(key)) {
      delete attrs[key];
      continue;
    }
    const clamped = clampValue(attrs[key] as SpanAttrs[string]);
    if (clamped === undefined) {
      delete attrs[key];
      continue;
    }
    attrs[key] = redactAttributeValue(key, clamped);
  }
}

export class MiraAttributeProcessor implements SpanProcessor {
  onStart(span: SdkSpan): void {
    scrubInPlace(span.attributes as unknown as Record<string, unknown>);
  }

  onEnd(span: ReadableSpan): void {
    scrubInPlace(span.attributes as unknown as Record<string, unknown>);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

interface InMemoryTestingHandle {
  exporter: InMemorySpanExporter;
  provider: NodeTracerProvider;
  reset(): void;
  finished(): ReadableSpan[];
}

let testingHandle: InMemoryTestingHandle | null = null;

/**
 * Test-only. Registers a NodeTracerProvider (SimpleSpanProcessor +
 * InMemorySpanExporter, behind MiraAttributeProcessor) as the global
 * tracer provider, so `withSpan`/`getTracer()` produce real, inspectable
 * spans in tests. `NodeTracerProvider.register()` with no args installs
 * the default AsyncLocalStorageContextManager, which is what preserves
 * trace context across `await`/`setTimeout` hops. Idempotent: a second
 * call returns the same handle rather than re-registering.
 */
export function __testing__installInMemoryExporter(): InMemoryTestingHandle {
  if (testingHandle) return testingHandle;

  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new MiraAttributeProcessor(), new SimpleSpanProcessor(exporter)],
  });
  provider.register();

  testingHandle = {
    exporter,
    provider,
    reset: () => exporter.reset(),
    finished: () => exporter.getFinishedSpans(),
  };
  return testingHandle;
}
