/**
 * The in-process OpenAI budget prices each call by the RESOLVED model id (#4968).
 *
 * Before: every OpenAI call was priced at the gpt-5.4-mini rate whatever
 * OPENAI_MODEL / OPENAI_CLASSIFIER_MODEL said, so a pricier model was
 * under-counted (~6.7x for gpt-5.5) and the cap tripped that much later.
 *
 * Contract:
 *  - the cap prices a call from the ONE shared per-model table
 *    (capabilities/openai-prices.ts), the same table telemetry reads (#4961);
 *  - a model priced at 10x the default trips the cap at 1/10 of the tokens;
 *  - an unpriced model is REFUSED at reserve time: never $0, never the default rate;
 *  - OPENAI_PRICE_PER_MTOK_IN/OUT still override, explicitly.
 *
 * Zero network: fetch is stubbed. Run:
 *   npx vitest run src/capabilities/__tests__/openai-budget-per-model.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OpenAiRunBudget,
  openAiRunBudget,
  reserveOpenAiAttempt,
  resetOpenAiRunBudgetForTests,
} from "../openai-run-budget";
import { OPENAI_PRICE_PER_MTOK_BY_MODEL, openAiPricePerMtok, type OpenAiPrice } from "../openai-prices";
import { estimateCostUsd } from "@/lib/inference/canonical-cascade";
import { cascadeComplete } from "@/lib/llm/cascade";

const PINNED = [
  "OPENAI_RUN_BUDGET_USD",
  "OPENAI_RUN_BUDGET_WINDOW_S",
  "OPENAI_PRICE_PER_MTOK_IN",
  "OPENAI_PRICE_PER_MTOK_OUT",
  "OPENAI_MODEL",
  "OPENAI_CLASSIFIER_MODEL",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "TOGETHERAI_API_KEY",
  "OPENROUTER_API_KEY",
];
const env = { ...process.env };
beforeEach(() => {
  for (const k of PINNED) delete process.env[k];
  resetOpenAiRunBudgetForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...env };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEFAULT = OPENAI_PRICE_PER_MTOK_BY_MODEL["gpt-5.4-mini"];
const TEN_X: OpenAiPrice = { input: DEFAULT.input * 10, output: DEFAULT.output * 10 };
const lookup = (m: string | null | undefined): OpenAiPrice | null =>
  m === "gpt-test-10x" ? TEN_X : openAiPricePerMtok(m);

/** Largest output-token count (step 1,000) the budget admits in one reservation. */
function admittedOutputTokens(b: OpenAiRunBudget, model?: string): number {
  let n = 0;
  while (b.precheck(0, n + 1_000, model).ok) n += 1_000;
  return n;
}

describe("the cap is priced by the resolved model (#4968)", () => {
  it("a model priced at 10x the default trips the cap at 1/10 of the tokens", () => {
    const base = new OpenAiRunBudget({ capUsd: 4.5, now: () => 0, priceLookup: lookup });
    const tenX = new OpenAiRunBudget({ capUsd: 4.5, now: () => 0, priceLookup: lookup, model: "gpt-test-10x" });
    const atDefault = admittedOutputTokens(base);
    const atTenX = admittedOutputTokens(tenX);
    expect(atDefault).toBe(1_000_000); // $4.50 cap / $4.50 per Mtok
    expect(atTenX).toBe(100_000);
    expect(atTenX * 10).toBe(atDefault);
  });

  it("OPENAI_MODEL selects the price: gpt-5.5 is counted at its own list rate, not gpt-5.4-mini's", () => {
    process.env.OPENAI_MODEL = "gpt-5.5";
    const b = openAiRunBudget();
    expect(b.estimateUsd(1_000_000, 1_000_000)).toBeCloseTo(5 + 30, 9);
    // Control: unset OPENAI_MODEL resolves to gpt-5.4-mini.
    delete process.env.OPENAI_MODEL;
    resetOpenAiRunBudgetForTests();
    expect(openAiRunBudget().estimateUsd(1_000_000, 1_000_000)).toBeCloseTo(0.75 + 4.5, 9);
  });

  it("a per-call model wins over the budget's default model (reserve + settle book at that model's rate)", () => {
    const b = new OpenAiRunBudget({ capUsd: 100, now: () => 0 }); // default model gpt-5.4-mini
    const v = b.reserve(1_000_000, 1_000_000, "gpt-5.5");
    expect(v.ok).toBe(true);
    expect(b.heldUsd).toBeCloseTo(35, 9);
    if (v.ok) v.reservation.settle(100_000, 10_000);
    expect(b.spentUsd).toBeCloseTo(0.1 * 5 + 0.01 * 30, 9);
    expect(b.heldUsd).toBe(0);
  });
});

describe("an unpriced model fails closed (#4968)", () => {
  it("an unknown OPENAI_MODEL refuses at reserve: no hold, no spend, a distinct reason", () => {
    process.env.OPENAI_MODEL = "gpt-unlisted-9";
    const v = openAiRunBudget().reserve(10, 10);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unpriced model "gpt-unlisted-9"/);
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBe(0);
    // The shared gate refuses the same way, so every caller falls through.
    expect(reserveOpenAiAttempt("OpenAI", "t", 10, 10)).toEqual({ ok: false });
    expect(reserveOpenAiAttempt("OpenAI", "t", 10, 10, "gpt-unlisted-9")).toEqual({ ok: false });
    // Control: a free provider is never gated, and a priced model on the same budget is admitted.
    expect(reserveOpenAiAttempt("Groq", "t", 10, 10, "gpt-unlisted-9")).toEqual({ ok: true, reservation: null });
    expect(openAiRunBudget().reserve(10, 10, "gpt-5.4-mini").ok).toBe(true);
  });

  it("an unknown model is never priced at $0 nor at the default rate, even for a tiny call under a huge cap", () => {
    const b = new OpenAiRunBudget({ capUsd: 1e9, now: () => 0, model: "gpt-unlisted-9" });
    expect(b.precheck(1, 1).ok).toBe(false);
    expect(b.estimateUsd(1, 1)).not.toBe(0);
    expect(b.estimateUsd(1, 1)).not.toBeCloseTo(new OpenAiRunBudget({ now: () => 0 }).estimateUsd(1, 1), 12);
    expect(b.estimateUsd(0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("an env price override does not price an unlisted model (the table is the gate)", () => {
    process.env.OPENAI_PRICE_PER_MTOK_IN = "0.75";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "4.5";
    process.env.OPENAI_MODEL = "gpt-unlisted-9";
    expect(openAiRunBudget().reserve(10, 10).ok).toBe(false);
  });
});

describe("env overrides keep working, explicitly", () => {
  it("OPENAI_PRICE_PER_MTOK_IN/OUT override a priced model's table rate", () => {
    process.env.OPENAI_MODEL = "gpt-5.5";
    process.env.OPENAI_PRICE_PER_MTOK_IN = "1";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "2";
    expect(openAiRunBudget().estimateUsd(1_000_000, 1_000_000)).toBeCloseTo(3, 9);
  });
  it("a junk or zero override falls back to the RESOLVED model's table rate, not to gpt-5.4-mini's", () => {
    process.env.OPENAI_MODEL = "gpt-5.5";
    process.env.OPENAI_PRICE_PER_MTOK_IN = "0";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "abc";
    expect(openAiRunBudget().estimateUsd(1_000_000, 1_000_000)).toBeCloseTo(5 + 30, 9);
  });
});

describe("ONE shared price table: telemetry and the cap cannot diverge (#4961 + #4968)", () => {
  const declared = JSON.parse(
    readFileSync(resolve(__dirname, "../../../../tools/review_router/prices.json"), "utf8"),
  ).usd_per_mtok as Record<string, { input: number; output: number }>;

  it("the table equals tools/review_router/prices.json, model for model", () => {
    expect(Object.keys(OPENAI_PRICE_PER_MTOK_BY_MODEL).sort()).toEqual(Object.keys(declared).sort());
    for (const [m, p] of Object.entries(declared)) {
      expect(OPENAI_PRICE_PER_MTOK_BY_MODEL[m], m).toEqual({ input: p.input, output: p.output });
    }
  });

  it("for every model, the cap's price equals the telemetry estimate", () => {
    for (const m of Object.keys(OPENAI_PRICE_PER_MTOK_BY_MODEL)) {
      const cap = new OpenAiRunBudget({ now: () => 0, model: m }).estimateUsd(1_000_000, 1_000_000);
      expect(estimateCostUsd("OpenAI", 1_000_000, 0, 1_000_000, m), m).toBeCloseTo(cap, 9);
    }
  });
});

describe("the non-streaming cascade prices the model it actually sends (OPENAI_CLASSIFIER_MODEL)", () => {
  function stubFetch() {
    const hosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        hosts.push(new URL(u).host);
        if (u.includes("api.openai.com")) {
          return Response.json({
            choices: [{ message: { content: "from openai" } }],
            usage: { prompt_tokens: 1_000, completion_tokens: 1_000 },
          });
        }
        return Response.json({ choices: [{ message: { content: "from groq" } }] });
      }),
    );
    return hosts;
  }
  const MESSAGES = [{ role: "user" as const, content: "what is a VFD" }];

  it("a pricier classifier model is booked at its own rate", async () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.GROQ_API_KEY = "k1";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    process.env.OPENAI_CLASSIFIER_MODEL = "gpt-5.5";
    stubFetch();
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("OpenAI");
    expect(openAiRunBudget().spentUsd).toBeCloseTo((1_000 / 1e6) * 5 + (1_000 / 1e6) * 30, 9);
  });

  it("an unpriced classifier model is refused BEFORE the fetch and the cascade falls through", async () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.GROQ_API_KEY = "k1";
    process.env.OPENAI_CLASSIFIER_MODEL = "gpt-unlisted-9";
    const hosts = stubFetch();
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect(hosts).toEqual(["api.groq.com"]);
    expect(openAiRunBudget().calls).toBe(0);
  });
});
