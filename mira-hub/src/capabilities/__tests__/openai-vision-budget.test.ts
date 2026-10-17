// Codex r1 F4 on #4355 — both OpenAI vision paths HOLD a worst-case bound, not
// an average, so a cap that the old chars/4 + 1,500-per-image estimate would
// have passed refuses BEFORE any fetch, and concurrent passes from one photo
// cannot overshoot it.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/openai-vision-budget

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiRunBudget,
  boundVisionInputTokens,
  estimateVisionInputTokens,
  imagePartMaxTokens,
  openAiRunBudget,
  resetOpenAiRunBudgetForTests,
} from "../openai-run-budget";
import { defaultVisionCall, openAiVisionCall, togetherVisionCall } from "@/lib/nameplate/passes";
import { OpenAIVisionRecognizer, TogetherVisionRecognizer, defaultRecognizer } from "@/lib/nameplate/index";

const MODEL = "gpt-5.4-mini";
const PROMPT = "Read every field on this nameplate.";
const IMG = { mimeType: "image/jpeg", base64: "QUJD" };
const ENV = { ...process.env };

/** USD at the default gpt-5.4-mini rate (0.75 in / 4.5 out per Mtok). */
const usd = (inputTokens: number, outputTokens: number) =>
  new OpenAiRunBudget({ now: () => 0 }).estimateUsd(inputTokens, outputTokens);

function stubOkFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "k0";
  delete process.env.OPENAI_MODEL;
  for (const k of ["OPENAI_PRICE_PER_MTOK_IN", "OPENAI_PRICE_PER_MTOK_OUT", "OPENAI_RUN_BUDGET_WINDOW_S"]) delete process.env[k];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the vision bound", () => {
  it("is keyed to VERIFIED models: 3,000 tokens per image for gpt-5.4-mini, no bound (null) for any other", () => {
    expect(imagePartMaxTokens(MODEL)).toBe(3_000);
    expect(imagePartMaxTokens("gpt-5.6-sol")).toBeNull();
    expect(boundVisionInputTokens(PROMPT, 1, MODEL)).toBe(Buffer.byteLength(PROMPT, "utf8") + 16 + 3_000);
    expect(boundVisionInputTokens(PROMPT, 1, "gpt-5.6-sol")).toBeNull();
    // Control: with no images the model does not matter.
    expect(boundVisionInputTokens(PROMPT, 0, "gpt-5.6-sol")).toBe(Buffer.byteLength(PROMPT, "utf8") + 16);
  });
  it("is never below the old average, and a token-dense hint is bounded by its bytes", () => {
    const dense = "故障代码".repeat(200);
    for (const p of [PROMPT, dense]) {
      expect(boundVisionInputTokens(p, 2, MODEL)!).toBeGreaterThan(estimateVisionInputTokens(p.length, 2));
    }
    expect(boundVisionInputTokens(dense, 0, MODEL)!).toBeGreaterThanOrEqual(Buffer.byteLength(dense, "utf8"));
  });
});

describe("LOOK vision call (passes.ts) — refuses before the fetch at a cap the average would pass", () => {
  const maxTokens = 100;
  const oldWorst = usd(estimateVisionInputTokens(PROMPT.length, 1), maxTokens);
  const newWorst = usd(boundVisionInputTokens(PROMPT, 1, MODEL)!, maxTokens);

  it("a cap between the old estimate and the new bound is refused, and nothing is sent", async () => {
    expect(newWorst).toBeGreaterThan(oldWorst); // precondition: the gap this test lives in
    process.env.OPENAI_RUN_BUDGET_USD = String((oldWorst + newWorst) / 2);
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubOkFetch();
    await expect(openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens })).rejects.toThrow(
      "recognizer_budget_exhausted",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAiRunBudget().spentUsd).toBe(0);
  });

  it("control: a cap that fits the bound sends exactly one request and books its actual usage", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = String(newWorst * 1.01);
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubOkFetch();
    await openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(openAiRunBudget().spentUsd).toBeCloseTo(usd(100, 10), 9);
    expect(openAiRunBudget().heldUsd).toBe(0);
  });

  it("concurrent passes from one photo cannot overshoot: room for one bound admits exactly one fetch", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = String(newWorst * 1.5);
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubOkFetch();
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("nameplate recognizer (index.ts) — refuses before the fetch at a cap the average would pass", () => {
  // The recognizer's prompt is module-private; read its length from source so
  // the precondition (the old hold fits under the cap) is asserted, not assumed.
  const src = readFileSync(resolve(__dirname, "../../lib/nameplate/index.ts"), "utf8");
  const promptChars = src.split("const VISION_PROMPT = `")[1].split("`;")[0].length;
  const oldWorst = usd(estimateVisionInputTokens(promptChars, 1), 1_200);
  // Below even the IMAGE-ONLY part of the new hold (3,000 + framing), so any prompt length is refused.
  const cap = usd(3_000 + 16, 1_200) * 0.999;

  it("a cap the old estimate fits but the image bound does not is refused, and nothing is sent", async () => {
    expect(promptChars).toBeGreaterThan(100);
    expect(oldWorst).toBeLessThan(cap); // precondition: the old hold would have been admitted
    process.env.OPENAI_RUN_BUDGET_USD = String(cap);
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubOkFetch();
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow("recognizer_budget_exhausted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("control: under the default cap it sends one request and settles the hold", async () => {
    delete process.env.OPENAI_RUN_BUDGET_USD;
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubOkFetch();
    await new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().calls).toBe(1);
  });
});

describe("an unverified OpenAI vision model is refused, never sized by a guess (Codex r2 F4 on #4355)", () => {
  beforeEach(() => {
    process.env.OPENAI_MODEL = "gpt-5.6-sol";
    process.env.TOGETHERAI_API_KEY = "kt";
    resetOpenAiRunBudgetForTests();
  });

  it("the LOOK vision call refuses before any fetch and logs why", async () => {
    const fetchMock = stubOkFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens: 100 })).rejects.toThrow(
      "recognizer_model_unverified",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("openai.vision_model_unverified");
  });

  it("the nameplate recognizer refuses before any fetch", async () => {
    const fetchMock = stubOkFetch();
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow("recognizer_model_unverified");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the provider pick falls back to the free Together path for both", () => {
    expect(defaultVisionCall()).toBe(togetherVisionCall);
    expect(defaultRecognizer()).toBeInstanceOf(TogetherVisionRecognizer);
  });

  it("control: on the verified model the pick stays OpenAI", () => {
    delete process.env.OPENAI_MODEL;
    expect(defaultVisionCall()).toBe(openAiVisionCall);
    expect(defaultRecognizer()).toBeInstanceOf(OpenAIVisionRecognizer);
  });
});

describe("a malformed usage block cannot poison the shared total (Codex r2 F8 on #4355)", () => {
  function stubGarbageUsageFetch() {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: "invalid", completion_tokens: -3 } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("the LOOK vision call books the hold's own bound and cap, stays finite, and the cap still bites", async () => {
    const maxTokens = 100;
    const worst = usd(boundVisionInputTokens(PROMPT, 1, MODEL)!, maxTokens);
    process.env.OPENAI_RUN_BUDGET_USD = String(worst * 1.5);
    resetOpenAiRunBudgetForTests();
    const fetchMock = stubGarbageUsageFetch();
    await openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens });
    expect(Number.isFinite(openAiRunBudget().spentUsd)).toBe(true);
    expect(openAiRunBudget().spentUsd).toBeCloseTo(worst, 9);
    await expect(openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens })).rejects.toThrow(
      "recognizer_budget_exhausted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the nameplate recognizer does the same", async () => {
    stubGarbageUsageFetch();
    await new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg").catch(() => undefined);
    expect(Number.isFinite(openAiRunBudget().spentUsd)).toBe(true);
    expect(openAiRunBudget().spentUsd).toBeGreaterThan(usd(3_000, 1_200)); // the reserved image bound and cap
  });

  it("settle sanitizes its own inputs for every caller; record refuses a non-finite cost", () => {
    const b = new OpenAiRunBudget({ capUsd: 1, now: () => 0 });
    const v = b.reserve(10_000, 100);
    if (!v.ok) throw new Error("precondition: the reservation fits");
    v.reservation.settle(Number.NaN, Number.POSITIVE_INFINITY);
    expect(b.spentUsd).toBeCloseTo(b.estimateUsd(10_000, 100), 12);
    const w = b.reserve(10_000, 100);
    if (!w.ok) throw new Error("precondition: the reservation fits");
    w.reservation.settle(-5, 7); // negative input is unknown; a valid output is kept
    expect(b.spentUsd).toBeCloseTo(b.estimateUsd(10_000, 100) + b.estimateUsd(10_000, 7), 12);
    expect(() => b.record(Number.NaN, 0)).toThrow(RangeError);
    expect(Number.isFinite(b.spentUsd)).toBe(true);
  });
});

describe("a 200 whose JSON is null never leaks its hold (Codex r3 F9 on #4355)", () => {
  function stubNullFetch() {
    const fetchMock = vi.fn(async () => new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  /** Drive the budget's clock (it reads Date.now) so a window can be rolled. */
  function clockAt(startS: number) {
    const c = { t: startS };
    vi.spyOn(Date, "now").mockImplementation(() => c.t * 1000);
    return c;
  }

  it("LOOK vision call: books the reserved worst case, holds nothing, and the next window admits again", async () => {
    const clock = clockAt(1_000_000);
    const maxTokens = 100;
    const worst = usd(boundVisionInputTokens(PROMPT, 1, MODEL)!, maxTokens);
    process.env.OPENAI_RUN_BUDGET_WINDOW_S = "60";
    process.env.OPENAI_RUN_BUDGET_USD = String(worst * 1.5);
    resetOpenAiRunBudgetForTests();
    stubNullFetch();
    await expect(openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens })).rejects.toThrow(
      "recognizer_provider_malformed",
    );
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBeCloseTo(worst, 9);
    // The booked worst case counts in this window...
    await expect(openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens })).rejects.toThrow(
      "recognizer_budget_exhausted",
    );
    // ...and nothing is left held, so the next window admits a valid call.
    clock.t += 61;
    const ok = stubOkFetch();
    await openAiVisionCall({ prompt: PROMPT, images: [IMG], temperature: 0, maxTokens });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(openAiRunBudget().heldUsd).toBe(0);
  });

  it("nameplate recognizer: the same — no leaked hold, and the next window admits again", async () => {
    const clock = clockAt(2_000_000);
    process.env.OPENAI_RUN_BUDGET_WINDOW_S = "60";
    resetOpenAiRunBudgetForTests();
    stubNullFetch();
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow("recognizer_provider_malformed");
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBeGreaterThan(usd(3_000, 1_200)); // the reserved image bound and cap
    const booked = openAiRunBudget().spentUsd;
    // Pin the cap just under two worst cases: a second call now would not fit.
    process.env.OPENAI_RUN_BUDGET_USD = String(booked * 1.5);
    resetOpenAiRunBudgetForTests();
    clock.t += 1;
    stubNullFetch();
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow("recognizer_provider_malformed");
    await expect(new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg")).rejects.toThrow("recognizer_budget_exhausted");
    expect(openAiRunBudget().heldUsd).toBe(0);
    clock.t += 61;
    const ok = stubOkFetch();
    await new OpenAIVisionRecognizer().recognize("QUJD", "image/jpeg");
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
