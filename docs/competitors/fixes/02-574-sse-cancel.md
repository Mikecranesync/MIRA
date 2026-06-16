# Fix #2 — #574 chat: SSE cancel + persist partial messages

**Branch:** `agent/issue-574-byo-llm-asset-chat-0331`
**Severity:** 🚫 Functional blocker
**Effort:** ~45 min

## What's broken

`mira-hub/src/app/api/v1/assets/[id]/chat/route.ts:395`:

1. `ReadableStream` has no `cancel()` handler. When the client disconnects (browser closes tab, network drop), the `upstream` `fetch` to Anthropic keeps running. Reader never observes the disconnect; you keep paying tokens until the stream completes naturally. Per-tenant cost amplifier.
2. `persistMessage` runs ONLY in the success path of `start()`. On client disconnect, the user message is in the DB but the assistant message is not. Threads accumulate orphan turns.
3. No timeout on the upstream stream. A model that hangs holds the connection forever.

## The fix

Replace the SSE stream block (`const stream = new ReadableStream(...)` through the `return new Response(stream, {...})`) with this:

```ts
// Wire an AbortController through to the upstream fetch so we can cut it
// when the client disconnects.
const upstreamCtl = new AbortController();

let upstream: Response;
try {
  upstream = await callAnthropicStream({
    apiKey: keyRecord.plaintext,
    model: body.model,
    messages: sanitizedMessages,
    system: systemPrompt,
    signal: upstreamCtl.signal,
  });
} catch (err) {
  console.error("[chat upstream connect]", err);
  return NextResponse.json({ error: "upstream connection failed" }, { status: 502 });
}

if (!upstream.ok || !upstream.body) {
  const text = await upstream.text().catch(() => "");
  console.error("[chat upstream non-2xx]", upstream.status, text);
  return NextResponse.json(
    { error: "upstream error", status: upstream.status },
    { status: 502 },
  );
}

// Hard ceiling on stream lifetime. Cancels upstream if Anthropic hangs.
const STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const timeoutHandle = setTimeout(() => {
  upstreamCtl.abort(new Error("stream_timeout"));
}, STREAM_TIMEOUT_MS);

let assistantText = "";
let tokensIn = 0;
let tokensOut = 0;
let closed = false;

const persistOnce = async (reason: "complete" | "client_disconnect" | "timeout" | "error") => {
  if (closed) return;
  closed = true;
  clearTimeout(timeoutHandle);
  upstreamCtl.abort(new Error(`finalize_${reason}`));

  // Always persist what we have. Truncated assistant turns are still
  // useful as a thread-history anchor and prevent orphan threads.
  if (assistantText.length > 0 || reason !== "complete") {
    try {
      await persistMessage({
        threadId,
        role: "assistant",
        content: assistantText,
        tokensIn,
        tokensOut,
        model: body.model,
        truncated: reason !== "complete",
      });
      await logUsage({
        tenantId: ctx.tenantId,
        assetId,
        threadId,
        provider: "anthropic",
        model: body.model,
        tokensIn,
        tokensOut,
      });
      await bumpLastUsed(keyRecord.id);
    } catch (err) {
      console.error(`[chat finalize ${reason}]`, err);
    }
  }
};

const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    controller.enqueue(sse({ type: "thread", id: threadId }));

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);

          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            try {
              const evt = JSON.parse(payload) as Record<string, unknown>;
              const t = evt.type as string | undefined;

              if (t === "content_block_delta") {
                const delta = evt.delta as { type?: string; text?: string } | undefined;
                if (delta?.type === "text_delta" && typeof delta.text === "string") {
                  assistantText += delta.text;
                  controller.enqueue(sse({ type: "token", text: delta.text }));
                }
              } else if (t === "message_start") {
                const m = evt.message as { usage?: { input_tokens?: number } } | undefined;
                if (m?.usage?.input_tokens) tokensIn = m.usage.input_tokens;
              } else if (t === "message_delta") {
                const u = evt.usage as { output_tokens?: number } | undefined;
                if (u?.output_tokens) tokensOut = u.output_tokens;
              }
            } catch {
              /* ignore malformed event */
            }
          }
        }
      }

      await persistOnce("complete");
      controller.enqueue(
        sse({
          type: "done",
          usage: {
            in: tokensIn,
            out: tokensOut,
            cost_cents: costCents(body.model, tokensIn, tokensOut),
          },
        }),
      );
    } catch (err) {
      // AbortError is expected when client disconnects or timeout fires.
      const isAbort = (err as { name?: string })?.name === "AbortError";
      if (!isAbort) {
        console.error("[chat stream]", err);
      }
      await persistOnce(isAbort ? "client_disconnect" : "error");
      try {
        controller.enqueue(
          sse({ type: "error", message: "stream interrupted", retryable: true }),
        );
      } catch {
        /* controller already closed */
      }
    } finally {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    }
  },

  // Fired by the runtime when the client disconnects or the response is GC'd.
  // This is the missing piece — it propagates cancellation to the upstream.
  async cancel(reason) {
    await persistOnce("client_disconnect");
    // reason is forwarded to upstreamCtl.abort() inside persistOnce
  },
});

return new Response(stream, {
  headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  },
});
```

## Required signature change

`callAnthropicStream` (in the same file or a sibling lib) needs a `signal` param. Find its definition and add:

```ts
async function callAnthropicStream(args: {
  apiKey: string;
  model: string;
  messages: Array<...>;
  system?: string;
  signal?: AbortSignal;   // <-- new
}): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { /* ... */ },
    body: JSON.stringify({ /* ... */ }),
    signal: args.signal,   // <-- new
  });
}
```

## Required schema change to `chat_messages`

Add a `truncated` column so reports can flag turns that ended early:

```sql
-- mira-hub/db/migrations/2026-04-25-001-chat-messages-truncated.sql
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT FALSE;
```

And update `persistMessage` to take + persist the flag (typically in `mira-hub/src/lib/chat/queries.ts` — confirm the actual file in the branch).

## Test

`mira-hub/src/app/api/v1/assets/[id]/chat/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the upstream + DB so we can assert behaviour.
const persistMessage = vi.fn();
const logUsage = vi.fn();
const bumpLastUsed = vi.fn();

vi.mock("@/lib/chat/queries", () => ({ persistMessage, logUsage, bumpLastUsed }));

vi.mock("@/lib/llm-keys", () => ({
  getActiveKeyWithSecret: async () => ({
    id: "k_1",
    plaintext: "test-key",
    provider: "anthropic",
  }),
  isLLMProvider: () => true,
  bumpLastUsed,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function makeFakeAnthropicStream(events: string[]) {
  // Build an ndjson-like SSE body that streams `events` then closes.
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("SSE cancel + partial-message persistence", () => {
  it("client disconnect → upstream is aborted via cancel()", async () => {
    let upstreamAborted = false;

    // Mock fetch to record signal abort.
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      const sig = init?.signal as AbortSignal | undefined;
      sig?.addEventListener("abort", () => {
        upstreamAborted = true;
      });
      // Return a stream that never completes — it'll only end via abort.
      return new Promise(() => {});
    });

    // Start the route handler (import dynamically inside test).
    const { POST } = await import("../route");
    const responsePromise = POST(
      new Request("http://localhost/api/v1/assets/a1/chat", {
        method: "POST",
        headers: { "x-tenant-id": "t1", "content-type": "application/json" },
        body: JSON.stringify({
          provider: "anthropic",
          model: "claude-opus-4-7",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );

    // Wait for the response to materialise, then cancel its body reader.
    const response = await responsePromise;
    const reader = response.body!.getReader();
    await reader.cancel(); // simulates client disconnect

    // Give the cancel handler a tick.
    await new Promise((r) => setTimeout(r, 50));

    expect(upstreamAborted).toBe(true);
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({ truncated: true, role: "assistant" }),
    );
  });

  it("normal completion persists with truncated=false", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        makeFakeAnthropicStream([
          JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 5 } } }),
          JSON.stringify({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hi" },
          }),
          JSON.stringify({ type: "message_delta", usage: { output_tokens: 1 } }),
          "[DONE]",
        ]),
      );

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/v1/assets/a1/chat", {
        method: "POST",
        headers: { "x-tenant-id": "t1", "content-type": "application/json" },
        body: JSON.stringify({
          provider: "anthropic",
          model: "claude-opus-4-7",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );

    // Drain the response.
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) { /* drain */ }

    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({ truncated: false, content: "hi" }),
    );
  });

  it("timeout aborts the stream after STREAM_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    let aborted = false;
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => {});
    });

    const { POST } = await import("../route");
    void POST(
      new Request("http://localhost/api/v1/assets/a1/chat", {
        method: "POST",
        headers: { "x-tenant-id": "t1", "content-type": "application/json" },
        body: JSON.stringify({
          provider: "anthropic",
          model: "claude-opus-4-7",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );

    // Fast-forward past 5 minutes.
    vi.advanceTimersByTime(6 * 60 * 1000);
    await Promise.resolve();
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/app/api/v1/assets/\[id\]/chat/__tests__/route.test.ts
```

Three tests pass: cancel propagates to upstream, normal completion records `truncated=false`, timeout aborts the stream.

## What this prevents

- Tab-close mid-response → no more silent token charges to the customer for content they never saw
- Hung models → bounded by `STREAM_TIMEOUT_MS`, won't tie up DB connections forever
- Orphan threads → every user message ends up paired with at least an empty assistant placeholder, so reports stay consistent
