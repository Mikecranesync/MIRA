import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QUERY_REWRITE_MAX_INPUT_CHARS,
  QUERY_REWRITE_MAX_OUTPUT_CHARS,
  QUERY_REWRITE_MAX_TOKENS,
  QUERY_REWRITE_PROMPT,
  QUERY_REWRITE_TIMEOUT_MS,
  queryRewriteEnabled,
  rewriteForManualSearch,
} from "@/capabilities/query-rewrite";
import { cascadeComplete, type CascadeResult } from "@/lib/llm/cascade";

const POST =
  "Hi all, got a PowerFlex 40 on a conveyor that trips every time the belt loads up, " +
  "no fault on the keypad just stops. Any ideas what to look at?";

type Complete = Parameters<typeof rewriteForManualSearch>[1];

function fakeComplete(reply: string | null, provider = "OpenAI") {
  const calls: Array<{ messages: unknown; opts: unknown }> = [];
  const complete: Complete = async (messages, opts) => {
    calls.push({ messages, opts });
    return reply === null ? null : { provider, content: reply, durationMs: 5 };
  };
  return { complete, calls };
}

describe("query-rewrite (NOTEBOOK_QUERY_REWRITE)", () => {
  const prev = process.env.NOTEBOOK_QUERY_REWRITE;
  beforeEach(() => {
    process.env.NOTEBOOK_QUERY_REWRITE = "1";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.NOTEBOOK_QUERY_REWRITE;
    else process.env.NOTEBOOK_QUERY_REWRITE = prev;
    vi.restoreAllMocks();
  });

  it("is off unless the flag is exactly '1' — and then never calls a model", async () => {
    for (const v of [undefined, "", "0", "true", "yes", "on"]) {
      if (v === undefined) delete process.env.NOTEBOOK_QUERY_REWRITE;
      else process.env.NOTEBOOK_QUERY_REWRITE = v;
      expect(queryRewriteEnabled()).toBe(false);
      const { complete, calls } = fakeComplete("Overcurrent Fault");
      const r = await rewriteForManualSearch(POST, complete);
      expect(r).toMatchObject({ rewritten: null, status: "off", provider: null });
      expect(calls).toHaveLength(0);
    }
    process.env.NOTEBOOK_QUERY_REWRITE = "1";
    expect(queryRewriteEnabled()).toBe(true);
  });

  it("sends the measured prompt, caps the input and the completion, and returns a one-line rewrite", async () => {
    const { complete, calls } = fakeComplete("Overcurrent Fault F12\nCurrent Limit A056\n  Motor Overload P033  \n");
    const r = await rewriteForManualSearch(POST, complete);
    expect(r.status).toBe("ran");
    expect(r.provider).toBe("OpenAI");
    // Newlines and runs of spaces collapse: manual-rag adds this as ONE OR variant.
    expect(r.rewritten).toBe("Overcurrent Fault F12 Current Limit A056 Motor Overload P033");
    expect(calls).toHaveLength(1);
    const { messages, opts } = calls[0] as { messages: Array<{ role: string; content: string }>; opts: { maxTokens: number; timeoutMs: number } };
    expect(messages[0]).toEqual({ role: "system", content: QUERY_REWRITE_PROMPT });
    expect(messages[1]).toEqual({ role: "user", content: POST });
    expect(opts.maxTokens).toBe(QUERY_REWRITE_MAX_TOKENS);
    expect(opts.timeoutMs).toBeGreaterThan(0);
  });

  it("truncates a very long post to the measured input window", async () => {
    const long = "x".repeat(QUERY_REWRITE_MAX_INPUT_CHARS + 500);
    const { complete, calls } = fakeComplete("Fault Descriptions");
    await rewriteForManualSearch(long, complete);
    const user = (calls[0] as { messages: Array<{ content: string }> }).messages[1].content;
    expect(user).toHaveLength(QUERY_REWRITE_MAX_INPUT_CHARS);
  });

  it("fails open: a null cascade result, an empty or runaway reply, or a throw leaves retrieval unchanged", async () => {
    expect(await rewriteForManualSearch(POST, fakeComplete(null).complete)).toMatchObject({ rewritten: null, status: "failed" });
    expect(await rewriteForManualSearch(POST, fakeComplete("   \n ").complete)).toMatchObject({ rewritten: null, status: "failed" });
    expect(await rewriteForManualSearch(POST, fakeComplete("y".repeat(QUERY_REWRITE_MAX_OUTPUT_CHARS + 1)).complete)).toMatchObject({
      rewritten: null,
      status: "failed",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing: Complete = async () => {
      throw new Error("provider down");
    };
    expect(await rewriteForManualSearch(POST, throwing)).toMatchObject({ rewritten: null, status: "failed", provider: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("enforces ONE overall deadline: a cascade that keeps trying providers is abandoned at the limit (Codex F2 on #5003)", async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      // A cascade that never answers (two stalled providers, each with its own timeout).
      const stalled: Complete = () => new Promise(() => {});
      const p = rewriteForManualSearch(POST, stalled).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(QUERY_REWRITE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const r = await p;
      expect(r).toMatchObject({ rewritten: null, status: "timeout", provider: null });
      // A reply that arrives AFTER the deadline is not used.
      let resolveLate: ((v: CascadeResult | null) => void) | undefined;
      const late: Complete = () => new Promise((res) => (resolveLate = res));
      const p2 = rewriteForManualSearch(POST, late);
      await vi.advanceTimersByTimeAsync(QUERY_REWRITE_TIMEOUT_MS);
      resolveLate?.({ provider: "OpenAI", content: "Overcurrent Fault", durationMs: 1 });
      expect(await p2).toMatchObject({ rewritten: null, status: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("at the deadline the REAL cascade aborts the request in flight and never contacts the next provider (Codex F2 round 2)", async () => {
    vi.useFakeTimers();
    const fetchCalls: string[] = [];
    // Provider A stalls, then fails (HTTP 500) just AFTER the rewrite deadline unless
    // its signal aborted it first; provider B would answer at once. Without the
    // abort the cascade walks on to B after A's 500 — that is the regression.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: { signal?: AbortSignal }) => {
        fetchCalls.push(url);
        if (url.includes("provider-a")) {
          return new Promise<Response>((res, rej) => {
            init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
            setTimeout(() => res(new Response("", { status: 500 })), QUERY_REWRITE_TIMEOUT_MS + 10);
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "Overcurrent Fault" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }),
        );
      }),
    );
    try {
      const providers = [
        { name: "A", url: "https://provider-a.test/v1/chat/completions", key: "k", model: "m" },
        { name: "B", url: "https://provider-b.test/v1/chat/completions", key: "k", model: "m" },
      ];
      const viaCascade: Complete = (messages, opts) => cascadeComplete(messages, { ...opts, providers });
      let settled = false;
      const p = rewriteForManualSearch(POST, viaCascade).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(QUERY_REWRITE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      expect(fetchCalls).toEqual(["https://provider-a.test/v1/chat/completions"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toMatchObject({ rewritten: null, status: "timeout" });
      // Let any abandoned continuation run: provider B must still never be called.
      await vi.advanceTimersByTimeAsync(QUERY_REWRITE_TIMEOUT_MS * 3);
      expect(fetchCalls).toEqual(["https://provider-a.test/v1/chat/completions"]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("skips an empty message without a call, and a rewrite identical to the message without using it", async () => {
    const { complete, calls } = fakeComplete("F81 fault");
    expect(await rewriteForManualSearch("   ", complete)).toMatchObject({ rewritten: null, status: "skipped_empty" });
    expect(calls).toHaveLength(0);
    expect(await rewriteForManualSearch("f81 FAULT", fakeComplete("F81  fault").complete)).toMatchObject({
      rewritten: null,
      status: "skipped_unchanged",
    });
  });
});
