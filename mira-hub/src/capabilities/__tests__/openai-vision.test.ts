// OpenAI leads the Hub VISION path when its key is set (D8, 2026-10-11).
//
// #4349 put OpenAI first in every TEXT cascade, but the nameplate recognizer and
// the look route's vision call still knew only Together (402 credit_limit) and
// Groq (400 organization_delinquent). Every staging photo scenario died as a 502
// `recognizer_provider_error_402`, the acceptance receipt was never written, and
// production could not be authorized. These tests pin:
//   1. the OpenAI model comes from OPENAI_MODEL (the `||` form — compose maps
//      `${VAR:-}`, which delivers an EMPTY STRING in-container) and ignores the
//      Together/Groq-specific NAMEPLATE_VISION_MODEL,
//   2. an OPENAI_API_KEY alone configures the recognizer and wins the pick,
//   3. the request is in the gpt-5 dialect (max_completion_tokens, no
//      temperature, reasoning_effort) — an inline max_tokens is an HTTP 400 on
//      the only funded provider (Codex F1 on #4349),
//   4. Together's body is byte-for-byte what it was (negative control).
//
// Lives under src/capabilities/__tests__ (the unguarded Hub test home); the
// look-route provider pick is pinned next door in look-vision-provider.test.ts.
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/openai-vision

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenAIVisionRecognizer,
  TogetherVisionRecognizer,
  openAiVisionModel,
  defaultRecognizer,
  isRecognizerConfigured,
} from "@/lib/nameplate";
import { openAiVisionCall, togetherVisionCall, defaultVisionCall } from "@/lib/nameplate/passes";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const providerError = (status: number, code?: string) =>
  new Response(JSON.stringify({ error: { code, message: "provider says no" } }), { status });

const env = { ...process.env };
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_VISION_MODEL;
  delete process.env.NAMEPLATE_RECOGNIZER;
  delete process.env.NAMEPLATE_VISION_MODEL;
  delete process.env.TOGETHERAI_VISION_MODEL;
});
afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
});

function bodyOf(fetchMock: ReturnType<typeof vi.spyOn>, call = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as Record<string, unknown>;
}

describe("openAiVisionModel", () => {
  it("defaults to gpt-5.4-mini, the model the paid lane already proves", () => {
    expect(openAiVisionModel()).toBe("gpt-5.4-mini");
  });
  it("honours OPENAI_MODEL and treats the compose empty-string as unset", () => {
    process.env.OPENAI_MODEL = "gpt-5.4";
    expect(openAiVisionModel()).toBe("gpt-5.4");
    process.env.OPENAI_MODEL = "";
    expect(openAiVisionModel()).toBe("gpt-5.4-mini");
  });
  it("ignores NAMEPLATE_VISION_MODEL — that id belongs to Together/Groq", () => {
    process.env.NAMEPLATE_VISION_MODEL = "MiniMaxAI/MiniMax-M3";
    expect(openAiVisionModel()).toBe("gpt-5.4-mini");
  });
});

describe("provider pick", () => {
  it("an OPENAI_API_KEY alone configures the recognizer", () => {
    expect(isRecognizerConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isRecognizerConfigured()).toBe(true);
  });
  it("OpenAI wins over Together when both keys are set; Together when OpenAI is unset", () => {
    process.env.TOGETHERAI_API_KEY = "tg-test";
    expect(defaultRecognizer().name).toBe("together-vision");
    process.env.OPENAI_API_KEY = "sk-test";
    expect(defaultRecognizer().name).toBe("openai-vision");
  });
  it("the fixture switch still beats every live provider", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.NAMEPLATE_RECOGNIZER = "fixture";
    expect(defaultRecognizer().name).toBe("fixture");
  });
  it("defaultVisionCall picks OpenAI only when its key is set", () => {
    expect(defaultVisionCall()).toBe(togetherVisionCall);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(defaultVisionCall()).toBe(openAiVisionCall);
  });
});

describe("OpenAIVisionRecognizer request dialect", () => {
  it("posts to OpenAI in the gpt-5 dialect and returns a normalized candidate", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(ok(JSON.stringify({ manufacturer: "Harrington", model: "NER005L", confidence: 0.9 })));

    const out = await new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg");

    expect(out.manufacturer).toBe("Harrington");
    expect(out.model).toBe("NER005L");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const body = bodyOf(fetchMock);
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.max_completion_tokens).toBe(1200);
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(body.response_format).toEqual({ type: "json_object" });
    const content = (body.messages as { content: { type: string }[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(["text", "image_url"]);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("keeps the status + short provider code on failure, never the free text", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerError(402, "insufficient_quota"));
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow(
      /^recognizer_provider_error_402_insufficient_quota$/,
    );
  });

  it("is not configured without its key", async () => {
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow(
      "recognizer_not_configured",
    );
  });

  it("negative control: Together's body still carries max_tokens + temperature", async () => {
    process.env.TOGETHERAI_API_KEY = "tg-test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok("{}"));
    await new TogetherVisionRecognizer().recognize("QUJD", "image/jpeg");
    const body = bodyOf(fetchMock);
    expect(body.max_tokens).toBe(1200);
    expect(body.temperature).toBe(0.1);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("openAiVisionCall (multi-pass + look seam)", () => {
  it("sends the per-pass cap as max_completion_tokens and drops temperature", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok('{"observation":"one enclosure"}'));

    const reply = await openAiVisionCall({
      prompt: "describe",
      images: [{ base64: "QUJD", mimeType: "image/png" }],
      temperature: 0.1,
      maxTokens: 700,
    });

    expect(reply).toEqual({ text: '{"observation":"one enclosure"}', model: "gpt-5.4-mini" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const body = bodyOf(fetchMock);
    expect(body.max_completion_tokens).toBe(700);
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("surfaces the provider status on failure and refuses without a key", async () => {
    await expect(
      openAiVisionCall({ prompt: "p", images: [], temperature: 0.1, maxTokens: 10 }),
    ).rejects.toThrow("recognizer_not_configured");
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerError(429));
    await expect(
      openAiVisionCall({ prompt: "p", images: [], temperature: 0.1, maxTokens: 10 }),
    ).rejects.toThrow("recognizer_provider_error_429");
  });
});
