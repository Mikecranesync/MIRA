// mira-hub/src/lib/upload-log.ts
//
// Structured JSON logger for the upload pipeline. Every status transition
// emits a single line of JSON with a stable shape:
//
//   {"ts":"2026-04-26T13:20:00.000Z","service":"mira-hub","component":"upload",
//    "event":"parsing","requestId":"...","uploadId":"...","tenantId":"...",
//    "durationMs":42,"...extra"}
//
// Stdlib console.log (Next.js standalone forwards stdout to the docker log
// driver). No new dep, no transport — every line is grep-correlatable by
// requestId across mira-hub, mira-ingest, and OpenWebUI.

export interface UploadLogContext {
  requestId: string;
  uploadId: string;
  tenantId: string;
}

export type UploadLogEvent =
  | "received"
  | "queued"
  | "fetching"
  | "parsing"
  | "parsed"
  | "failed"
  | "cancelled";

export interface UploadLogger {
  ctx: UploadLogContext;
  start: number;
  log(event: UploadLogEvent | string, data?: Record<string, unknown>): void;
  error(event: string, err: unknown, data?: Record<string, unknown>): void;
}

export function makeUploadLogger(ctx: UploadLogContext): UploadLogger {
  const start = Date.now();
  return {
    ctx,
    start,
    log(event, data) {
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        service: "mira-hub",
        component: "upload",
        event,
        durationMs: Date.now() - start,
        ...ctx,
        ...(data ?? {}),
      };
      console.log(JSON.stringify(entry));
    },
    error(event, err, data) {
      const e = err instanceof Error ? err : new Error(String(err));
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        service: "mira-hub",
        component: "upload",
        event,
        durationMs: Date.now() - start,
        ...ctx,
        error: { message: e.message, name: e.name, stack: e.stack?.split("\n").slice(0, 5).join("\n") },
        ...(data ?? {}),
      };
      console.error(JSON.stringify(entry));
    },
  };
}
