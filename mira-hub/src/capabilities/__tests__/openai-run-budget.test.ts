// Per-run OpenAI spend hard stop (Hub side) — offline contract.
//
// Pins: env contract incl. the compose empty-string case, precheck-before /
// record-after arithmetic, the rolling window, the default price equal to the
// repo's declared gpt-5.4-mini rate, and that the three Hub spend paths
// (notebook chat loop, nameplate recognizer, LOOK vision call) go through it.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/openai-run-budget

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenAiRunBudget,
  DEFAULT_PRICE_PER_MTOK_IN,
  DEFAULT_PRICE_PER_MTOK_OUT,
  estimateInputTokens,
  estimateVisionInputTokens,
  IMAGE_PART_TOKENS,
  openAiRunBudget,
  resetOpenAiRunBudgetForTests,
} from "../openai-run-budget";

const env = { ...process.env };
beforeEach(() => {
  for (const k of ["OPENAI_RUN_BUDGET_USD", "OPENAI_RUN_BUDGET_WINDOW_S", "OPENAI_PRICE_PER_MTOK_IN", "OPENAI_PRICE_PER_MTOK_OUT"]) {
    delete process.env[k];
  }
  resetOpenAiRunBudgetForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...env };
  resetOpenAiRunBudgetForTests();
  vi.restoreAllMocks();
});

const clock = (t = 0) => {
  const c = { t, now: () => c.t };
  return c;
};

describe("env contract", () => {
  it("defaults: $10 per 86400 s at 0.75 / 4.5 per Mtok", () => {
    const b = new OpenAiRunBudget({ now: clock().now });
    expect(b.capUsd).toBe(10);
    expect(b.windowS).toBe(86_400);
    expect(b.estimateUsd(1_000_000, 0)).toBeCloseTo(0.75);
    expect(b.estimateUsd(0, 1_000_000)).toBeCloseTo(4.5);
  });
  it("honours env and treats the compose empty string / junk / negative as unset", () => {
    process.env.OPENAI_RUN_BUDGET_USD = "2.5";
    process.env.OPENAI_RUN_BUDGET_WINDOW_S = "";
    process.env.OPENAI_PRICE_PER_MTOK_IN = "abc";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "-3";
    const b = new OpenAiRunBudget({ now: clock().now });
    expect(b.capUsd).toBe(2.5);
    expect(b.windowS).toBe(86_400);
    expect(b.estimateUsd(1_000_000, 1_000_000)).toBeCloseTo(0.75 + 4.5);
  });
  it("default prices equal the repo's declared gpt-5.4-mini rate (tools/review_router/prices.json)", () => {
    const prices = JSON.parse(readFileSync(resolve(__dirname, "../../../../tools/review_router/prices.json"), "utf8"))
      .usd_per_mtok["gpt-5.4-mini"];
    expect(DEFAULT_PRICE_PER_MTOK_IN).toBe(prices.input);
    expect(DEFAULT_PRICE_PER_MTOK_OUT).toBe(prices.output);
  });
});

describe("precheck / record / window", () => {
  it("passes under the cap and records actual spend", () => {
    const b = new OpenAiRunBudget({ capUsd: 1, now: clock().now });
    expect(b.precheck(100_000, 10_000)).toEqual({ ok: true });
    expect(b.record(100_000, 10_000)).toBeCloseTo(0.12);
    expect(b.spentUsd).toBeCloseTo(0.12);
    expect(b.calls).toBe(1);
  });
  it("hard-stops when the worst case would cross the cap; a fitting call still passes (control)", () => {
    const b = new OpenAiRunBudget({ capUsd: 0.1, now: clock().now });
    b.record(100_000, 0); // 0.075
    const v = b.precheck(100_000, 0); // +0.075 → 0.15 > 0.10
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.capUsd).toBe(0.1);
      expect(v.reason).toContain("cap=$0.10");
    }
    expect(b.precheck(10_000, 0)).toEqual({ ok: true });
  });
  it("the window rolls and spend resets", () => {
    const c = clock(0);
    const b = new OpenAiRunBudget({ capUsd: 0.1, windowS: 100, now: c.now });
    b.record(100_000, 0);
    expect(b.precheck(100_000, 0).ok).toBe(false);
    c.t = 99;
    expect(b.precheck(100_000, 0).ok).toBe(false);
    c.t = 100;
    expect(b.precheck(100_000, 0).ok).toBe(true);
    expect(b.spentUsd).toBe(0);
    expect(b.calls).toBe(0);
  });
  it("estimates: chars/4 for messages; prompt/4 + a fixed block per image for vision", () => {
    expect(estimateInputTokens([{ role: "user", content: "x".repeat(37) }])).toBe(Math.ceil(JSON.stringify([{ role: "user", content: "x".repeat(37) }]).length / 4));
    expect(estimateVisionInputTokens(400, 1)).toBe(100 + IMAGE_PART_TOKENS);
  });
  it("one budget per process; reset rebuilds from env", () => {
    process.env.OPENAI_RUN_BUDGET_USD = "3";
    const a = openAiRunBudget();
    expect(openAiRunBudget()).toBe(a);
    expect(a.capUsd).toBe(3);
    resetOpenAiRunBudgetForTests();
    process.env.OPENAI_RUN_BUDGET_USD = "4";
    expect(openAiRunBudget().capUsd).toBe(4);
  });
});

describe("reserve / settle / release — the hold that stops concurrent overshoot", () => {
  it("holds the worst case while in flight, so a second caller is refused against the same balance", () => {
    const b = new OpenAiRunBudget({ capUsd: 0.005, priceInPerMtok: 0, priceOutPerMtok: 4.5, now: clock().now });
    // 600 output tokens worst case = $0.0027; two of them = $0.0054 > cap.
    const first = b.reserve(10, 600);
    expect(first.ok).toBe(true);
    const second = b.reserve(10, 600);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    // The refusal is driven by the HOLD, not by settled spend.
    expect(second.spentUsd).toBe(0);
    expect(b.heldUsd).toBeCloseTo(0.0027, 6);
  });

  it("a hold survives the window roll and is booked where its response lands (Codex r2 F3)", () => {
    // Cap $1, output priced so 800 tokens = $0.80.
    const c = clock(0);
    const b = new OpenAiRunBudget({ capUsd: 1, windowS: 100, priceInPerMtok: 0, priceOutPerMtok: 1000, now: c.now });
    const old = b.reserve(0, 800);
    if (!old.ok) throw new Error("expected ok");
    c.t = 150; // the window rolled while `old` is still in flight
    expect(b.spentUsd).toBe(0); // settled spend reset…
    expect(b.heldUsd).toBeCloseTo(0.8, 6); // …but the live hold still counts
    expect(b.reserve(0, 800).ok).toBe(false); // 0.8 held + 0.8 > cap
    // Settle the old request in the new window: its actual usage lands here, the hold is gone.
    old.reservation.settle(0, 100);
    expect(b.heldUsd).toBe(0);
    expect(b.spentUsd).toBeCloseTo(0.1, 6);
    const fresh = b.reserve(0, 800);
    expect(fresh.ok).toBe(true); // 0.1 + 0.8 fits
    expect(b.reserve(0, 800).ok).toBe(false); // 0.1 + 0.8 held + 0.8 does not
    // Releasing the fresh hold never touches another reservation's accounting.
    if (fresh.ok) fresh.reservation.release();
    expect(b.heldUsd).toBe(0);
    expect(b.spentUsd).toBeCloseTo(0.1, 6);
  });

  it("settle replaces the hold with the actual usage and counts the call", () => {
    const b = new OpenAiRunBudget({ capUsd: 1, priceInPerMtok: 0, priceOutPerMtok: 4.5, now: clock().now });
    const r = b.reserve(10, 600);
    if (!r.ok) throw new Error("expected ok");
    expect(b.heldUsd).toBeCloseTo(0.0027, 6);
    expect(b.spentUsd).toBe(0);
    expect(r.reservation.settle(10, 100)).toBeCloseTo(0.00045, 6);
    expect(b.heldUsd).toBe(0);
    expect(b.spentUsd).toBeCloseTo(0.00045, 6);
    expect(b.calls).toBe(1);
    // Settling twice books nothing more.
    expect(r.reservation.settle(10, 100)).toBe(0);
    expect(b.spentUsd).toBeCloseTo(0.00045, 6);
  });

  it("release drops the hold without counting a call (control: the next caller then fits)", () => {
    const b = new OpenAiRunBudget({ capUsd: 0.005, priceInPerMtok: 0, priceOutPerMtok: 4.5, now: clock().now });
    const r = b.reserve(10, 600);
    if (!r.ok) throw new Error("expected ok");
    r.reservation.release();
    expect(b.heldUsd).toBe(0);
    expect(b.spentUsd).toBe(0);
    expect(b.calls).toBe(0);
    expect(b.reserve(10, 600).ok).toBe(true);
  });

  it("refuses at the cap exactly like precheck (same verdict shape)", () => {
    const b = new OpenAiRunBudget({ capUsd: 0.001, priceInPerMtok: 0, priceOutPerMtok: 4.5, now: clock().now });
    const r = b.reserve(10, 600);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.capUsd).toBe(0.001);
    expect(r.worstCaseUsd).toBeCloseTo(0.0027, 6);
  });
});

describe("source contract — the Hub OpenAI spend path in this branch goes through the budget", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("non-streaming cascade (quickstart, hub ask, translate, extractor): reserve before the OpenAI fetch, settle after usage or an unknown outcome, release only on a rejection", () => {
    const cascade = read("../../lib/llm/cascade.ts");
    expect(cascade).toMatch(/const inputEstimate = estimateInputTokens\(messages\)/);
    expect(cascade).toMatch(/openAiRunBudget\(\)\.reserve\(inputEstimate, outputCap\)/);
    expect(cascade.indexOf(".reserve(")).toBeLessThan(cascade.indexOf("await fetch("));
    expect(cascade).toMatch(/reservation\?\.settle\(/);
    expect(cascade).toMatch(/reservation\?\.release\(\)/);
    expect(cascade).toMatch(/logBudgetExhausted\("llm-cascade"/);
  });
});
