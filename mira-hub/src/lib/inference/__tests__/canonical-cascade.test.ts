/**
 * Canonical inference seam — contract tests.
 *
 * These pin the two divergences the seam exists to remove (P0004 map §10 Q4):
 * the provider list must match Hard Constraint #2, and every request must ask
 * for usage. Both are silent failures otherwise — a wrong cascade still answers,
 * and a missing `stream_options` still streams; you just never learn the cost.
 *
 * Run: npx vitest run src/lib/inference/__tests__/canonical-cascade.test.ts
 */
import { beforeEach, describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  buildRequestBody,
  canonicalProviders,
  canonicalSeamEnabled,
  estimateCostUsd,
  exhaustedUsage,
  maxOutputTokens,
  routeReasonFor,
  usageFrame,
  usageFromRaw,
} from "../canonical-cascade";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.GROQ_API_KEY = "k1";
  process.env.CEREBRAS_API_KEY = "k2";
  process.env.TOGETHERAI_API_KEY = "k3";
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("cascade contract — Hard Constraint #2", () => {
  it("is exactly Groq → Cerebras → Together, in that order", () => {
    expect(canonicalProviders().map((p) => p.name)).toEqual(["Groq", "Cerebras", "Together"]);
  });

  it("does NOT include Gemini — the divergence this seam removes", () => {
    // The legacy inline cascade listed Gemini third, contradicting root
    // CLAUDE.md. If this ever passes again the two runtimes have re-diverged.
    const names = canonicalProviders().map((p) => p.name.toLowerCase());
    expect(names).not.toContain("gemini");
    expect(canonicalProviders().some((p) => p.url.includes("googleapis"))).toBe(false);
  });

  it("does not include Anthropic — removed in PR #610, never reintroduce", () => {
    const all = JSON.stringify(canonicalProviders()).toLowerCase();
    expect(all).not.toContain("anthropic");
  });

  it("reads the SAME env vars as the Python router so runtimes cannot drift", () => {
    process.env.GROQ_MODEL = "groq-x";
    process.env.CEREBRAS_MODEL = "cere-x";
    process.env.TOGETHERAI_MODEL = "together-x";
    expect(canonicalProviders().map((p) => p.model)).toEqual(["groq-x", "cere-x", "together-x"]);
  });

  it("omits a provider with no key rather than calling it unauthenticated", () => {
    delete process.env.CEREBRAS_API_KEY;
    const withKeys = canonicalProviders().filter((p) => p.key);
    expect(withKeys.map((p) => p.name)).toEqual(["Groq", "Together"]);
  });
});

describe("request body — usage must be requested", () => {
  it("sets stream_options.include_usage (without it there is NO cost telemetry)", () => {
    const body = buildRequestBody(canonicalProviders()[0], [{ role: "user", content: "hi" }], 800);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("carries provider-specific extras (Groq reasoning_effort)", () => {
    const body = buildRequestBody(canonicalProviders()[0], [], 800);
    expect(body.reasoning_effort).toBe("low");
  });

  it("does not leak Groq's extras onto other providers", () => {
    const body = buildRequestBody(canonicalProviders()[2], [], 800);
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("cost estimation", () => {
  it("prices input and output separately", () => {
    // Groq 0.15/Mtok in, 0.75/Mtok out → 1M in + 1M out = 0.90
    expect(estimateCostUsd("Groq", 1_000_000, 0, 1_000_000)).toBeCloseTo(0.9, 6);
  });

  it("discounts cached input instead of overstating spend", () => {
    const fresh = estimateCostUsd("Groq", 1_000_000, 0, 0)!;
    const cached = estimateCostUsd("Groq", 1_000_000, 1_000_000, 0)!;
    expect(cached).toBeLessThan(fresh);
    expect(cached).toBeCloseTo(fresh * 0.1, 6);
  });

  it("returns null — never 0 — for an unpriced provider", () => {
    // 0 would render as "this turn was free", which is a lie, not an estimate.
    expect(estimateCostUsd("SomeNewProvider", 1000, 0, 1000)).toBeNull();
  });

  it("rounds to 6dp to match NUMERIC(12,6) in migration 078", () => {
    const c = estimateCostUsd("Groq", 7, 0, 3)!;
    expect(String(c).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});

describe("usage record — mirrors migration 078 columns", () => {
  it("maps an OpenAI-compatible usage block onto the canonical shape", () => {
    const u = usageFromRaw(
      "Groq",
      "openai/gpt-oss-120b",
      { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } },
      "primary",
      [],
    );
    expect(u).toMatchObject({
      provider: "Groq",
      model: "openai/gpt-oss-120b",
      routeReason: "primary",
      inputTokens: 1200,
      cachedInputTokens: 200,
      outputTokens: 300,
      status: "ok",
    });
    expect(u.costUsdEstimate).toBeGreaterThan(0);
  });

  it("survives a provider that returns no usage block (nulls, not zeros)", () => {
    const u = usageFromRaw("Cerebras", "m", undefined, "primary", []);
    expect(u.inputTokens).toBeNull();
    expect(u.outputTokens).toBeNull();
  });

  it("records the fallback chain when an earlier provider failed", () => {
    expect(routeReasonFor([])).toBe("primary");
    expect(routeReasonFor(["Groq"])).toBe("fallback:Groq");
    expect(routeReasonFor(["Groq", "Cerebras"])).toBe("fallback:Groq,Cerebras");
  });

  it("reports exhaustion as an error status, not a silent success", () => {
    const u = exhaustedUsage(["Groq", "Cerebras", "Together"]);
    expect(u.status).toBe("error");
    expect(u.provider).toBeNull();
    expect(u.routeReason).toBe("exhausted:Groq,Cerebras,Together");
  });

  it("distinguishes 'no provider configured' from 'all providers failed'", () => {
    expect(exhaustedUsage([]).routeReason).toBe("no_provider_configured");
  });
});

describe("cost cap", () => {
  it("defaults to a declared ceiling rather than an open tap", () => {
    delete process.env.MIRA_TURN_MAX_OUTPUT_TOKENS;
    expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("honours an operator override", () => {
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "250";
    expect(maxOutputTokens()).toBe(250);
  });

  it("ignores a garbage or non-positive override instead of disabling the cap", () => {
    for (const bad of ["nonsense", "0", "-5", ""]) {
      process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = bad;
      expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    }
  });
});

describe("feature flag", () => {
  it("is OFF unless explicitly set to 1 — production path is the fallback", () => {
    for (const v of [undefined, "", "0", "true", "yes", "on"]) {
      if (v === undefined) delete process.env.MIRA_CANONICAL_SEAM;
      else process.env.MIRA_CANONICAL_SEAM = v;
      expect(canonicalSeamEnabled()).toBe(false);
    }
  });

  it("is ON for exactly '1'", () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    expect(canonicalSeamEnabled()).toBe(true);
  });
});

describe("usage frame", () => {
  it("is a `usage` kind carrying every 078 field", () => {
    const f = usageFrame(usageFromRaw("Groq", "m", { prompt_tokens: 5, completion_tokens: 2 }, "primary", []));
    expect(f.kind).toBe("usage");
    for (const k of [
      "provider",
      "model",
      "routeReason",
      "inputTokens",
      "cachedInputTokens",
      "outputTokens",
      "costUsdEstimate",
      "status",
    ]) {
      expect(f).toHaveProperty(k);
    }
  });

  it("carries no question, answer, or excerpt — it is a spend record", () => {
    const f = usageFrame(usageFromRaw("Groq", "m", { prompt_tokens: 5 }, "primary", []));
    const json = JSON.stringify(f).toLowerCase();
    for (const leak of ["question", "answer", "content", "excerpt", "citation"]) {
      expect(json).not.toContain(leak);
    }
  });
});
