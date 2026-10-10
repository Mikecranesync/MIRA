/** #4344: exercise the reused seam without transports or paid provider calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequestBody, canonicalProviders, exhaustedUsage, usageFromRaw } from "@/lib/inference/canonical-cascade";

beforeEach(() => {
  for (const name of ["GROQ_MODEL", "CEREBRAS_MODEL", "TOGETHERAI_MODEL", "GROQ_REASONING_EFFORT", "MIRA_NOTEBOOK_PROVIDER", "OPENAI_MODEL"]) vi.stubEnv(name, undefined);
  vi.stubEnv("GROQ_API_KEY", "groq-test");
  vi.stubEnv("CEREBRAS_API_KEY", "cerebras-test");
  vi.stubEnv("TOGETHERAI_API_KEY", "together-test");
  vi.stubEnv("OPENAI_API_KEY", "openai-test");
});
afterEach(() => vi.unstubAllEnvs());

const totals = { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 300 } };
const response = { model: "gpt-6.1-sol", service_tier: "default" };
function solUsage(raw: Parameters<typeof usageFromRaw>[2] = totals, metadata = response, model = "gpt-6.1-sol") {
  return usageFromRaw("OpenAI", model, raw, "primary", [], "ok", metadata);
}

describe("Sol opt-in isolation", () => {
  it("keeps default provider objects unchanged even while notebook OpenAI is enabled", () => {
    vi.stubEnv("MIRA_NOTEBOOK_PROVIDER", "openai");
    expect(canonicalProviders()).toEqual([
      { name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", key: "groq-test", model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
      { name: "Cerebras", url: "https://api.cerebras.ai/v1/chat/completions", key: "cerebras-test", model: "gpt-oss-120b" },
      { name: "Together", url: "https://api.together.xyz/v1/chat/completions", key: "together-test", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    ]);
  });
  it("requires explicit notebook scope and exact opt-in", () => {
    for (const setting of [undefined, "", "OpenAI", "groq"]) {
      vi.stubEnv("MIRA_NOTEBOOK_PROVIDER", setting);
      expect(canonicalProviders("notebook").map(p => p.name)).toEqual(["Groq", "Cerebras", "Together"]);
    }
    vi.stubEnv("MIRA_NOTEBOOK_PROVIDER", "openai");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-astra");
    expect(canonicalProviders("notebook")).toEqual([{ name: "OpenAI", url: "https://api.openai.com/v1/chat/completions", key: "openai-test", model: "gpt-6.1-sol" }]);
  });
  it("has no implicit provider substitution after a missing key or candidate exhaustion", () => {
    vi.stubEnv("MIRA_NOTEBOOK_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    expect(canonicalProviders("notebook").filter(p => p.key)).toEqual([]);
    expect(exhaustedUsage(["OpenAI"])).toMatchObject({ status: "error", provider: null, costUsdEstimate: null });
    expect(canonicalProviders("notebook").map(p => p.name)).toEqual(["OpenAI"]);
  });
});

describe("Sol Chat Completions contract without model tools", () => {
  it("preserves messages and emits supported bounded medium payload despite arbitrary extras", () => {
    vi.stubEnv("MIRA_NOTEBOOK_PROVIDER", "openai");
    const messages = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,fixture" } }] }];
    const provider = { ...canonicalProviders("notebook")[0], extra: { tools: [{ type: "function" }], temperature: 0.3, store: true } };
    const body = buildRequestBody(provider, messages, 800);
    expect(body).toEqual({ model: "gpt-6.1-sol", messages, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 800, reasoning_effort: "medium", store: false, service_tier: "default" });
    expect(body.messages).toBe(messages);
  });
  it("rejects another OpenAI model and invalid output bounds rather than sending a paid request", () => {
    const provider = { name: "OpenAI", url: "https://api.openai.com/v1/chat/completions", model: "gpt-6.1-sol" };
    expect(() => buildRequestBody({ ...provider, model: "gpt-6-astra" }, [], 800)).toThrow();
    for (const cap of [0, -1, 0.5, NaN, Infinity]) expect(() => buildRequestBody(provider, [], cap)).toThrow();
    expect(buildRequestBody(provider, [], 128001).max_completion_tokens).toBe(128000);
  });
  it("keeps the incumbent request protocol intact", () => {
    expect(buildRequestBody(canonicalProviders()[0], [], 800)).toEqual({ model: "openai/gpt-oss-120b", messages: [], stream: true, stream_options: { include_usage: true }, max_tokens: 800, temperature: 0.3, reasoning_effort: "low" });
  });
});

describe("Sol actual usage pricing", () => {
  it("bills fresh input, cache reads and cache writes at distinct standard prices", () => {
    // 500*2 + 200*0.10 + 300*2.50 + 200*10 = $0.003770.
    expect(solUsage().costUsdEstimate).toBe(0.00377);
  });
  it("prices reasoning within the completion total without adding it twice", () => {
    expect(solUsage({ ...totals, completion_tokens_details: { reasoning_tokens: 180 } }).costUsdEstimate).toBe(0.00377);
  });
  it("uses long-context prices only above the published boundary", () => {
    for (const [prompt_tokens, want] of [[272000, 0.554], [272001, 1.103004]]) {
      expect(solUsage({ prompt_tokens, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }).costUsdEstimate).toBe(want);
    }
  });
  it("keeps unknown usage and missing cache accounting null rather than inventing free tokens", () => {
    for (const raw of [undefined, null, {}, { prompt_tokens: 1000 }, { completion_tokens: 200 }, { prompt_tokens: 1000, completion_tokens: 200 }, { ...totals, prompt_tokens_details: { cached_tokens: 0 } }, { ...totals, prompt_tokens_details: { cache_write_tokens: 0 } }]) {
      expect(usageFromRaw("OpenAI", "gpt-6.1-sol", raw, "primary", [], "ok", response).costUsdEstimate).toBeNull();
    }
  });
  it("requires actual exact model and standard tier metadata instead of trusting the configured model", () => {
    expect(usageFromRaw("OpenAI", "gpt-6.1-sol", totals, "primary", []).costUsdEstimate).toBeNull();
    for (const metadata of [{ model: "gpt-6-astra", service_tier: "default" }, { model: "gpt-6.1-sol", service_tier: "auto" }, { model: "gpt-6.1-sol", service_tier: "priority" }, { model: "gpt-6.1-sol", service_tier: "" }]) expect(solUsage(totals, metadata).costUsdEstimate).toBeNull();
    expect(solUsage(totals, response, "gpt-6-astra").costUsdEstimate).toBeNull();
  });
  it("rejects malformed counts, overlapping cache usage and impossible reasoning usage", () => {
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(solUsage({ ...totals, prompt_tokens: bad }).costUsdEstimate).toBeNull();
      expect(solUsage({ ...totals, completion_tokens: bad }).costUsdEstimate).toBeNull();
      expect(solUsage({ ...totals, prompt_tokens_details: { cached_tokens: bad, cache_write_tokens: 0 } }).costUsdEstimate).toBeNull();
      expect(solUsage({ ...totals, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: bad } }).costUsdEstimate).toBeNull();
      expect(solUsage({ ...totals, completion_tokens_details: { reasoning_tokens: bad } }).costUsdEstimate).toBeNull();
    }
    expect(solUsage({ ...totals, prompt_tokens_details: { cached_tokens: 500, cache_write_tokens: 501 } }).costUsdEstimate).toBeNull();
    expect(solUsage({ ...totals, completion_tokens_details: { reasoning_tokens: 201 } }).costUsdEstimate).toBeNull();
  });
  it("preserves token telemetry when cost is unknown and distinguishes known zero", () => {
    expect(solUsage(totals, { ...response, service_tier: "priority" })).toMatchObject({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 200, costUsdEstimate: null });
    expect(solUsage({ prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }).costUsdEstimate).toBe(0);
  });
});
