// STUB — replaced by lane I1 at integration.
//
// Lane I3 (turn-recorder.ts) needs `setSpanAttrs`/`activeTraceId` to exist so
// it can mirror packet stage data onto the active OTel span, but the real
// tracer (getTracer/withSpan/the allowlist+redaction SpanProcessor) is owned
// by lane I1 and is being written in the same window in a different worktree.
// This file exists ONLY so I3 compiles and tests in isolation; it is dropped
// wholesale and replaced by I1's real implementation at integration — see
// docs/architecture/observability/2026-09-22-turn-flight-recorder.md §10.
export type SpanAttrs = Record<string, string | number | boolean | string[] | number[] | null | undefined>;

export function setSpanAttrs(_attrs: SpanAttrs): void {}

export function activeTraceId(): string | null {
  return null;
}
