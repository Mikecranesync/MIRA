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
import { openAiVisionCall } from "@/lib/nameplate/passes";
import { OpenAIVisionRecognizer } from "@/lib/nameplate/index";

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
  it("is keyed to the model: 3,000 tokens per image for gpt-5.4-mini, fail-closed for an unknown model", () => {
    expect(imagePartMaxTokens(MODEL)).toBe(3_000);
    expect(imagePartMaxTokens("some-new-vision-model")).toBe(20_000);
    expect(boundVisionInputTokens(PROMPT, 1, MODEL)).toBe(Buffer.byteLength(PROMPT, "utf8") + 16 + 3_000);
  });
  it("is never below the old average, and a token-dense hint is bounded by its bytes", () => {
    const dense = "故障代码".repeat(200);
    for (const p of [PROMPT, dense]) {
      expect(boundVisionInputTokens(p, 2, MODEL)).toBeGreaterThan(estimateVisionInputTokens(p.length, 2));
    }
    expect(boundVisionInputTokens(dense, 0, MODEL)).toBeGreaterThanOrEqual(Buffer.byteLength(dense, "utf8"));
  });
});

describe("LOOK vision call (passes.ts) — refuses before the fetch at a cap the average would pass", () => {
  const maxTokens = 100;
  const oldWorst = usd(estimateVisionInputTokens(PROMPT.length, 1), maxTokens);
  const newWorst = usd(boundVisionInputTokens(PROMPT, 1, MODEL), maxTokens);

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
