/**
 * Lost or invalid usage records a NULL cost, never $0 (#4978).
 *
 * Migration 080's contract: missing usage = NULL (0 means "free"), and
 * tenantSpendSince counts `cost_usd_estimate IS NULL` as unpriced. Before this
 * fix estimateCostUsd() read a missing count as 0, so a priced turn whose
 * final usage frame was lost recorded 0.000000 — a paid turn booked as free.
 *
 * Every invalid case below changes exactly ONE count; the others stay valid,
 * so each case fails only on its own rule.
 *
 * Run: npx vitest run src/capabilities/__tests__/lost-usage-cost-null.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { estimateCostUsd, usageFromRaw } from "@/lib/inference/canonical-cascade";

const declared = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tools/review_router/prices.json"), "utf8"),
).usd_per_mtok as Record<string, { input: number; cached_input: number; output: number }>;

describe("absent usage → null cost (#4978)", () => {
  it("an OpenAI turn with NO usage block records null, not 0", () => {
    expect(usageFromRaw("OpenAI", "gpt-5.4-mini", undefined, "primary", []).costUsdEstimate).toBeNull();
  });

  it("a null usage block records null, not 0", () => {
    expect(usageFromRaw("OpenAI", "gpt-5.4-mini", null, "primary", []).costUsdEstimate).toBeNull();
  });

  it("prompt-only partial usage (completion_tokens missing) records null", () => {
    expect(
      usageFromRaw("OpenAI", "gpt-5.4-mini", { prompt_tokens: 1200 }, "primary", []).costUsdEstimate,
    ).toBeNull();
  });

  it("completion-only partial usage (prompt_tokens missing) records null", () => {
    expect(
      usageFromRaw("OpenAI", "gpt-5.4-mini", { completion_tokens: 300 }, "primary", []).costUsdEstimate,
    ).toBeNull();
  });

  it("the same rule holds for a provider-priced entry (Groq lost usage was also $0)", () => {
    expect(usageFromRaw("Groq", "openai/gpt-oss-120b", undefined, "primary", []).costUsdEstimate).toBeNull();
  });
});

describe("invalid counts → null cost (#4978)", () => {
  // [label, input, cached, output] — exactly one field is invalid per row.
  const bad: [string, number | null, number | null, number | null][] = [
    ["input negative", -1, 0, 100],
    ["input NaN", Number.NaN, 0, 100],
    ["input non-integer", 1.5, 0, 100],
    ["input Infinity", Number.POSITIVE_INFINITY, 0, 100],
    ["output negative", 100, 0, -1],
    ["output NaN", 100, 0, Number.NaN],
    ["output non-integer", 100, 0, 2.5],
    ["cached negative", 100, -1, 100],
    ["cached NaN", 100, Number.NaN, 100],
    ["cached non-integer", 100, 0.5, 100],
  ];
  it.each(bad)("%s → null", (_label, input, cached, output) => {
    expect(estimateCostUsd("OpenAI", input, cached, output, "gpt-5.4-mini")).toBeNull();
  });

  it("cached > input → null (a cached count cannot exceed the prompt)", () => {
    expect(estimateCostUsd("OpenAI", 100, 101, 100, "gpt-5.4-mini")).toBeNull();
    expect(
      usageFromRaw(
        "OpenAI",
        "gpt-5.4-mini",
        { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 101 } },
        "primary",
        [],
      ).costUsdEstimate,
    ).toBeNull();
  });
});

describe("controls — real usage is still priced (#4978)", () => {
  it("a genuine reported zero-token usage block is exactly 0, not null", () => {
    const u = usageFromRaw(
      "OpenAI",
      "gpt-5.4-mini",
      { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
      "primary",
      [],
    );
    expect(u.costUsdEstimate).toBe(0);
  });

  it("full usage keeps the existing priced number", () => {
    const p = declared["gpt-5.4-mini"];
    const u = usageFromRaw(
      "OpenAI",
      "gpt-5.4-mini",
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      "primary",
      [],
    );
    expect(u.costUsdEstimate).toBeCloseTo(p.input + p.output, 6);
  });

  it("an absent cached count is 0 cached, not invalid (prompt_tokens_details is optional)", () => {
    const p = declared["gpt-5.4-mini"];
    expect(estimateCostUsd("OpenAI", 1_000_000, null, 0, "gpt-5.4-mini")).toBeCloseTo(p.input, 6);
  });

  it("cached == input is valid (fully cached prompt)", () => {
    const p = declared["gpt-5.4-mini"];
    expect(estimateCostUsd("OpenAI", 1_000_000, 1_000_000, 0, "gpt-5.4-mini")).toBeCloseTo(p.cached_input, 6);
  });
});
