/**
 * Truthful chat progress (#4687).
 *
 * The notebook chat route only opens its SSE stream after identity, retrieval and context
 * assembly, so a technician stares at a typing dot for the slowest part of the turn. With
 * MIRA_CHAT_PROGRESS=1 and a client that opts in (`x-mira-progress: 1`), this opens the stream
 * immediately and the route reports each stage at the moment it actually starts. Nothing is
 * timed or guessed: no `reportProgress` call, no frame.
 *
 * Opt-in per request keeps every existing client byte-identical — they never see the early
 * stream, the new frame kinds, or the changed error shape.
 *
 * Frames (opted-in clients only, all additive):
 *   { kind: "progress", stage }           — a stage started
 *   { kind: "headers", headers }          — the inner SSE response's headers (sent after it resolves)
 *   { kind: "http_error", status, body }  — the inner handler returned a non-SSE response
 */
export type ChatProgressStage =
  | "finding_equipment"
  | "searching_documentation"
  | "generating_answer"
  | "checking_answer";

const sinks = new WeakMap<Request, (stage: ChatProgressStage) => void>();
const cancels = new WeakMap<Request, AbortSignal>();

/**
 * Aborts when an opted-in client's response stream is cancelled. The request's own signal does
 * not necessarily fire then, so the route treats this exactly like `req.signal` (Codex #4765 F2).
 */
export function progressCancelSignal(req: Request): AbortSignal | undefined {
  return cancels.get(req);
}

/** Called by the route where a stage starts. A no-op unless this request opted in. */
export function reportProgress(req: Request, stage: ChatProgressStage): void {
  sinks.get(req)?.(stage);
}

export function wantsProgress(req: Request): boolean {
  return process.env.MIRA_CHAT_PROGRESS === "1" && req.headers.get("x-mira-progress") === "1";
}

const FORWARDED_HEADERS = ["x-safety-stop", "x-idempotent-replay", "x-mira-trace-id"];

/**
 * Open the SSE response now and run `handler` behind it. Each stage is emitted once, in the
 * order first reported. When the handler resolves, its SSE body is piped through unchanged;
 * any other response becomes one `http_error` frame plus the usual `[DONE]`.
 */
export function withProgressStream(req: Request, handler: () => Promise<Response>): Response {
  const enc = new TextEncoder();
  const sent = new Set<ChatProgressStage>();
  let closed = false;
  let inner: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const cancelled = new AbortController();
  cancels.set(req, cancelled.signal);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (frame: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      sinks.set(req, (stage) => {
        if (sent.has(stage)) return;
        sent.add(stage);
        write({ kind: "progress", stage });
      });
      const sendDone = () => {
        if (!closed) controller.enqueue(enc.encode("data: [DONE]\n\n"));
      };
      const finish = () => {
        sinks.delete(req);
        if (closed) return;
        closed = true;
        controller.close();
      };

      void (async () => {
        try {
          const res = await handler();
          if (closed) {
            await res.body?.cancel().catch(() => undefined);
            return;
          }
          if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
            const headers: Record<string, string> = {};
            for (const name of FORWARDED_HEADERS) {
              const v = res.headers.get(name);
              if (v !== null) headers[name] = v;
            }
            for (const [name, v] of res.headers) if (name.startsWith("x-safety-")) headers[name] = v;
            if (Object.keys(headers).length > 0) write({ kind: "headers", headers });
            inner = res.body.getReader();
            for (;;) {
              const { value, done } = await inner.read();
              if (done || closed) break;
              controller.enqueue(value);
            }
          } else {
            let body: unknown = null;
            try {
              body = await res.json();
            } catch {
              body = null;
            }
            write({ kind: "http_error", status: res.status, body });
            sendDone();
          }
        } catch (err) {
          console.error("[chat-progress] handler failed after the stream opened:", err);
          write({ kind: "http_error", status: 500, body: { error: "internal_error" } });
          sendDone();
        } finally {
          finish();
        }
      })();
    },
    cancel() {
      closed = true;
      cancelled.abort();
      sinks.delete(req);
      void inner?.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
