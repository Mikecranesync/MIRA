/**
 * OpenAI leads the Hub's NON-streaming cascade too (`lib/llm/cascade.ts`).
 *
 * Found 2026-10-11 by the production E2E smoke after v3.393.4 shipped: the
 * public quickstart money path (`/api/quickstart/ask`), `/api/hub/ask`,
 * `/api/mira/ask`, translate-for-search and the relationship extractor all go
 * through this module, which still listed Groq → Cerebras → Together only. With
 * Groq billing-restricted and Together at 402, the public grounded-chat page
 * answered 503 "every model provider is unreachable" while the notebook route
 * (canonical cascade, OpenAI first since #4349) answered fine.
 *
 * Contract pinned here, mirroring `openai-first-cascade.test.ts`:
 *   - no OPENAI_API_KEY → byte-identical to the old list and the old body;
 *   - with the key → OpenAI is tried first, in the gpt-5 dialect
 *     (`max_completion_tokens`, no `temperature`, `reasoning_effort`);
 *   - an OpenAI failure falls through to the next provider;
 *   - `jsonMode` rides to OpenAI; an empty OPENAI_MODEL keeps the default.
 *
 * Run: npx vitest run src/capabilities/__tests__/llm-cascade-openai-first.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cascadeComplete } from "@/lib/llm/cascade";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_CLASSIFIER_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.GROQ_CLASSIFIER_MODEL;
  delete process.env.GROQ_MODEL;
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

type Call = { url: string; body: Record<string, unknown>; auth: string | undefined };

/** fetch stub: OpenAI answers per `openai` (status or content); Groq always answers. */
function stubFetch(openai: { status: number } | { content: string } = { content: "from openai" }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: u, body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: headers.Authorization });
      if (u.includes("api.openai.com")) {
        if ("status" in openai) return new Response("nope", { status: openai.status });
        return Response.json({ choices: [{ message: { content: openai.content } }] });
      }
      return Response.json({ choices: [{ message: { content: "from groq" } }] });
    }),
  );
  return calls;
}

const MESSAGES = [{ role: "user" as const, content: "PowerFlex 525 fault F0004 on power-up" }];

describe("lib/llm/cascade — OpenAI leads, key-gated", () => {
  it("control: with no OPENAI_API_KEY the first call is Groq with the classic body (max_tokens + temperature)", async () => {
    const calls = stubFetch();
    const r = await cascadeComplete(MESSAGES, { maxTokens: 700, temperature: 0.1 });
    expect(r?.provider).toBe("Groq");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("api.groq.com");
    expect(calls[0].body).toMatchObject({ model: "openai/gpt-oss-20b", max_tokens: 700, temperature: 0.1, stream: false });
    expect(calls[0].body).not.toHaveProperty("max_completion_tokens");
  });

  it("with OPENAI_API_KEY set, OpenAI is tried FIRST in the gpt-5 dialect and serves", async () => {
    process.env.OPENAI_API_KEY = "k0";
    const calls = stubFetch({ content: "from openai" });
    const r = await cascadeComplete(MESSAGES, { maxTokens: 700, temperature: 0.1 });
    expect(r).toMatchObject({ provider: "OpenAI", content: "from openai" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer k0");
    expect(calls[0].body).toMatchObject({
      model: "gpt-5.4-mini",
      max_completion_tokens: 700,
      reasoning_effort: "low",
      stream: false,
    });
    // The gpt-5 family 400s on either of these — that 400 would read as an outage.
    expect(calls[0].body).not.toHaveProperty("max_tokens");
    expect(calls[0].body).not.toHaveProperty("temperature");
  });

  it("an OpenAI failure (402) falls through to Groq, which still gets the classic body", async () => {
    process.env.OPENAI_API_KEY = "k0";
    const calls = stubFetch({ status: 402 });
    const r = await cascadeComplete(MESSAGES, { maxTokens: 500, temperature: 0.2 });
    expect(r?.provider).toBe("Groq");
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.openai.com", "api.groq.com"]);
    expect(calls[1].body).toMatchObject({ max_tokens: 500, temperature: 0.2 });
    expect(calls[1].body).not.toHaveProperty("max_completion_tokens");
  });

  it("jsonMode rides to OpenAI as response_format", async () => {
    process.env.OPENAI_API_KEY = "k0";
    const calls = stubFetch();
    await cascadeComplete(MESSAGES, { jsonMode: true, temperature: 0.0, maxTokens: 600 });
    expect(calls[0].url).toContain("api.openai.com");
    expect(calls[0].body).toMatchObject({ response_format: { type: "json_object" }, max_completion_tokens: 600 });
  });

  it("model + effort env: an EMPTY OPENAI_MODEL keeps the default; OPENAI_CLASSIFIER_MODEL wins over OPENAI_MODEL", async () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.OPENAI_MODEL = "";
    let calls = stubFetch();
    await cascadeComplete(MESSAGES);
    expect(calls[0].body.model).toBe("gpt-5.4-mini");

    process.env.OPENAI_MODEL = "gpt-x";
    process.env.OPENAI_CLASSIFIER_MODEL = "gpt-small";
    process.env.OPENAI_REASONING_EFFORT = "medium";
    calls = stubFetch();
    await cascadeComplete(MESSAGES);
    expect(calls[0].body).toMatchObject({ model: "gpt-small", reasoning_effort: "medium" });
  });
});
