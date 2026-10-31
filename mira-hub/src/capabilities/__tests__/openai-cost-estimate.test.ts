/**
 * OpenAI turns record a cost estimate, priced per MODEL (#4961).
 *
 * `PRICE_PER_MTOK` is keyed by provider and had no OpenAI entry, so every
 * OpenAI-served turn recorded costUsdEstimate = null. These tests pin the
 * per-model pricing and its null-not-0 controls. They live here, not in
 * src/lib/inference/__tests__/ (a guarded legacy path), and test the same
 * exported functions.
 *
 * Run: npx vitest run src/capabilities/__tests__/openai-cost-estimate.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { estimateCostUsd, usageFromRaw } from "@/lib/inference/canonical-cascade";

describe("cost estimation — OpenAI is priced per MODEL (#4961)", () => {
  // The repo's declared OpenAI list prices; openai-run-budget.test.ts pins the
  // budget defaults to the same file, so telemetry and the cap cannot drift.
  const declared = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../tools/review_router/prices.json"), "utf8"),
  ).usd_per_mtok as Record<string, { input: number; cached_input: number; output: number }>;

  it("an OpenAI-served gpt-5.4-mini turn records the declared list-price estimate, not null", () => {
    const p = declared["gpt-5.4-mini"];
    const u = usageFromRaw("OpenAI", "gpt-5.4-mini", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, "primary", []);
    expect(u.costUsdEstimate).toBeCloseTo(p.input + p.output, 6);
  });

  it("bills cached input at the declared cached rate", () => {
    const p = declared["gpt-5.4-mini"];
    expect(estimateCostUsd("OpenAI", 1_000_000, 1_000_000, 0, "gpt-5.4-mini")).toBeCloseTo(p.cached_input, 6);
  });

  it("bills cached input at each model's DECLARED cached rate, not a flat 10% of input (#5011 F2)", () => {
    // gpt-6.1-sol: cached_input 0.10 against input 2.00 (5%). A flat 10% books 0.20.
    const sol = estimateCostUsd("OpenAI", 1_000_000, 1_000_000, 0, "gpt-6.1-sol");
    expect(sol).toBeCloseTo(0.1, 6);
    expect(sol).not.toBeCloseTo(0.2, 6);
    // Parity for every priced model, so a future price refresh cannot drift the two.
    for (const [m, p] of Object.entries(declared)) {
      expect(estimateCostUsd("OpenAI", 1_000_000, 1_000_000, 0, m), m).toBeCloseTo(p.cached_input, 6);
    }
  });

  it("provider-priced entries keep the 10% cached discount (control)", () => {
    expect(estimateCostUsd("Groq", 1_000_000, 1_000_000, 0, "openai/gpt-oss-120b")).toBeCloseTo(0.015, 6);
  });

  it("an OpenAI model with no declared price is null — never 0 and never another model's rate", () => {
    expect(estimateCostUsd("OpenAI", 1_000_000, 0, 1_000_000, "gpt-5.5-unlisted")).toBeNull();
    expect(usageFromRaw("OpenAI", "gpt-5.5-unlisted", { prompt_tokens: 10, completion_tokens: 10 }, "primary", []).costUsdEstimate).toBeNull();
  });

  it("an OpenAI turn without a model id is null (the provider name alone does not price it)", () => {
    expect(estimateCostUsd("OpenAI", 1_000_000, 0, 1_000_000)).toBeNull();
  });

  it("provider-priced entries are unchanged by the model argument (control)", () => {
    expect(estimateCostUsd("Groq", 1_000_000, 0, 1_000_000, "openai/gpt-oss-120b")).toBeCloseTo(0.9, 6);
  });
});
