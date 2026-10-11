/**
 * OpenAI leads the Hub's canonical cascade (owner directive 2026-10-11) — offline contract.
 *
 * Mirrors mira-bots/tests/test_openai_first_cascade.py so the two runtimes
 * cannot drift: same env names, same default model, same request dialect.
 * The gpt-5 family rejects `max_tokens` (wants `max_completion_tokens`) and
 * any non-default `temperature` with HTTP 400 — a mistake there would look
 * like a provider outage and fall through to Groq, the billing-restricted
 * provider OpenAI was added to replace.
 *
 * The pre-existing contract file (`src/lib/inference/__tests__/canonical-cascade.test.ts`)
 * runs with no OPENAI_API_KEY and is untouched: with the key unset the list is
 * byte-identical to the old cascade, which that file pins.
 *
 * Run: npx vitest run src/capabilities/__tests__/openai-first-cascade.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRequestBody, canonicalProviders } from "@/lib/inference/canonical-cascade";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("OpenAI-first cascade — key-gated, same shape as the Python router", () => {
  it("with no OPENAI_API_KEY the cascade is exactly the pre-existing Groq → Cerebras → Together", () => {
    expect(canonicalProviders().map((p) => p.name)).toEqual(["Groq", "Cerebras", "Together"]);
  });

  it("with OPENAI_API_KEY set, OpenAI leads with the gpt-5.4-mini default in the reasoning dialect", () => {
    process.env.OPENAI_API_KEY = "k0";
    const [openai, ...rest] = canonicalProviders();
    expect(openai).toMatchObject({
      name: "OpenAI",
      url: "https://api.openai.com/v1/chat/completions",
      key: "k0",
      model: "gpt-5.4-mini",
      requestStyle: "openai-reasoning",
      extra: { reasoning_effort: "low" },
    });
    expect(rest.map((p) => p.name)).toEqual(["Groq", "Cerebras", "Together"]);
  });

  it("an EMPTY OPENAI_MODEL (compose's ${OPENAI_MODEL:-} in-container) does not win over the default", () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.OPENAI_MODEL = "";
    expect(canonicalProviders()[0].model).toBe("gpt-5.4-mini");
    process.env.OPENAI_MODEL = "gpt-x";
    expect(canonicalProviders()[0].model).toBe("gpt-x");
  });

  it("builds the gpt-5 dialect for OpenAI (max_completion_tokens, no temperature) and the classic body for the rest", () => {
    process.env.OPENAI_API_KEY = "k0";
    const [openai, groq] = canonicalProviders();
    const o = buildRequestBody(openai, [{ role: "user", content: "hi" }], 500);
    expect(o).toMatchObject({ model: "gpt-5.4-mini", max_completion_tokens: 500, stream: true, reasoning_effort: "low" });
    expect(o).toMatchObject({ stream_options: { include_usage: true } });
    expect(o).not.toHaveProperty("max_tokens");
    expect(o).not.toHaveProperty("temperature");
    const g = buildRequestBody(groq, [{ role: "user", content: "hi" }], 500);
    expect(g).toMatchObject({ max_tokens: 500, temperature: 0.3 });
    expect(g).not.toHaveProperty("max_completion_tokens");
  });

  it("still never lists Gemini or Anthropic", () => {
    process.env.OPENAI_API_KEY = "k0";
    const all = JSON.stringify(canonicalProviders()).toLowerCase();
    expect(all).not.toContain("gemini");
    expect(all).not.toContain("anthropic");
    expect(all).not.toContain("googleapis");
  });
});
