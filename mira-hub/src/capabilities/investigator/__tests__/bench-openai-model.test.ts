/**
 * Tests for `tools/investigator/openai-model.ts` (BENCH-A lane).
 *
 * Lives here (not under `tools/investigator/`) because `vitest.config.ts`
 * only collects `src/**\/*.test.ts` — this is the one vitest-discoverable
 * location in the repo, confirmed by the mission brief's own test command
 * (`npx vitest run src/capabilities/investigator`). Prefixed `bench-` to
 * avoid colliding with CORE's `budget.test.ts`/`grounding.test.ts`/
 * `hazard-gate.test.ts`/`plan.test.ts` in the same shared directory.
 *
 * Per the $0 paid-inference hard rule, `fetch` is ALWAYS mocked here — no
 * test in this file makes a real network call.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENAI_MODEL, OpenAiSynthesisModel } from "../../../../../tools/investigator/openai-model";

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenAiSynthesisModel", () => {
  it("sends no temperature key, max_completion_tokens, and the default model", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = fakeFetch((_url, init) => {
      capturedBody = JSON.parse(String(init.body));
      return jsonResponse({
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
    });
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "test-key", fetchImpl });
    await model.complete({ system: "sys", user: "usr", maxOutputTokens: 123 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(capturedBody!.max_completion_tokens).toBe(123);
    expect("temperature" in capturedBody!).toBe(false);
    expect("response_format" in capturedBody!).toBe(false); // responseFormat: "text" → no key at all
  });

  it('includes response_format: {type:"json_object"} only when responseFormat is "json_object"', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = fakeFetch((_url, init) => {
      capturedBody = JSON.parse(String(init.body));
      return jsonResponse({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} });
    });
    const model = new OpenAiSynthesisModel({ responseFormat: "json_object", apiKey: "test-key", fetchImpl });
    await model.complete({ system: "sys", user: "usr", maxOutputTokens: 50 });
    expect(capturedBody!.response_format).toEqual({ type: "json_object" });
  });

  it("parses text and usage from a successful response", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "the answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      }),
    );
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "k", fetchImpl });
    const result = await model.complete({ system: "s", user: "u", maxOutputTokens: 10 });
    expect(result).toEqual({ text: "the answer", inputTokens: 42, outputTokens: 7 });
  });

  it("throws when finish_reason is length and content is empty (reasoning tokens consumed the budget)", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: {} }),
    );
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "k", fetchImpl, maxRetries: 0 });
    await expect(model.complete({ system: "s", user: "u", maxOutputTokens: 10 })).rejects.toThrow(/finish_reason=length/);
  });

  it("does NOT throw on finish_reason=length when content is non-empty", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ choices: [{ message: { content: "partial but present" }, finish_reason: "length" }], usage: {} }),
    );
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "k", fetchImpl, maxRetries: 0 });
    const result = await model.complete({ system: "s", user: "u", maxOutputTokens: 10 });
    expect(result.text).toBe("partial but present");
  });

  it("retries once on a 500 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} });
    });
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "k", fetchImpl, maxRetries: 2 });
    const result = await model.complete({ system: "s", user: "u", maxOutputTokens: 10 });
    expect(result.text).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry on a 400 (request-shape error)", async () => {
    let calls = 0;
    const fetchImpl = fakeFetch(() => {
      calls += 1;
      return jsonResponse({ error: "bad request" }, 400);
    });
    const model = new OpenAiSynthesisModel({ responseFormat: "text", apiKey: "k", fetchImpl, maxRetries: 2 });
    await expect(model.complete({ system: "s", user: "u", maxOutputTokens: 10 })).rejects.toThrow(/OpenAI 400/);
    expect(calls).toBe(1);
  });

  it("throws when OPENAI_API_KEY is missing and no apiKey option is given", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const model = new OpenAiSynthesisModel({ responseFormat: "text", fetchImpl: fakeFetch(() => jsonResponse({})) });
      await expect(model.complete({ system: "s", user: "u", maxOutputTokens: 10 })).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

/**
 * MUTATION CHECK (recorded per task instructions — "break one line on
 * purpose, confirm a named test fails, restore"):
 *
 * Mutated `openai-model.ts`'s request body construction to unconditionally
 * add `body.temperature = 0.7;` right after the `max_completion_tokens` line.
 * Named test that failed: "sends no temperature key, max_completion_tokens,
 * and the default model" (assertion `expect("temperature" in capturedBody!).toBe(false)`
 * went from pass to fail: `expected true to be false`). Restored the file to
 * its original (no `temperature` key) and reran — test passed again.
 */
