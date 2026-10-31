/**
 * The non-streaming cascade's OpenAI leg is spend-capped (Codex F1 on #4357).
 *
 * Contract: with OPENAI_API_KEY set, every OpenAI call reserves its worst case
 * against the process budget BEFORE the fetch; a served response settles the
 * reservation with the provider's actual usage; a failed request releases it;
 * once the cap would be crossed, OpenAI is skipped (no fetch) and the cascade
 * falls through to the next provider, which still answers. Concurrent callers
 * are bounded by the hold, not just by the balance at the moment they check.
 *
 * Run: npx vitest run src/capabilities/__tests__/llm-cascade-budget.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cascadeComplete } from "@/lib/llm/cascade";
import { openAiRunBudget, resetOpenAiRunBudgetForTests } from "@/capabilities/openai-run-budget";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.OPENAI_API_KEY = "k0";
  process.env.GROQ_API_KEY = "k1";
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  // Input priced at (almost) zero so the arithmetic is only the 600-token
  // output cap: worst case per call = 600 / 1e6 * 4.5 = $0.0027. Not "0":
  // a zero price is junk and falls back to the default (Gate 7 on #4355).
  process.env.OPENAI_PRICE_PER_MTOK_IN = "0.000001";
  process.env.OPENAI_PRICE_PER_MTOK_OUT = "4.5";
  resetOpenAiRunBudgetForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Call = { host: string };

/** fetch stub: OpenAI answers per `openai`; Groq always answers. `gate` lets a test hold OpenAI in flight. */
function stubFetch(
  openai: { status: number } | { content: string; usage?: { prompt_tokens: number; completion_tokens: number } } | { throws: true },
  gate?: Promise<void>,
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push({ host: new URL(u).host });
      if (u.includes("api.openai.com")) {
        if (gate) await gate;
        if ("throws" in openai) throw new TypeError("network down");
        if ("status" in openai) return new Response("nope", { status: openai.status });
        return Response.json({ choices: [{ message: { content: openai.content } }], usage: openai.usage });
      }
      return Response.json({ choices: [{ message: { content: "from groq" } }] });
    }),
  );
  return calls;
}

const MESSAGES = [{ role: "user" as const, content: "PowerFlex 525 fault F0004 on power-up" }];
const hosts = (calls: Call[]) => calls.map((c) => c.host);

describe("lib/llm/cascade — the OpenAI leg is spend-capped", () => {
  it("a 200 whose JSON is null books the worst case, leaks no hold, and falls through (Codex r3 F9 on #4355)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("api.openai.com")
          ? new Response("null", { status: 200 })
          : Response.json({ choices: [{ message: { content: "from groq" } }] }),
      ),
    );
    const r = await cascadeComplete(MESSAGES);
    expect(r?.provider).toBe("Groq");
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBeGreaterThanOrEqual(0.0027 - 1e-9); // the 600-token output cap at 4.5 / Mtok
  });

  it("control (Codex r2 F4 on #4355): a TEXT call on a model with no verified image bound still goes to OpenAI", async () => {
    // A PRICED model with no verified image bound (only gpt-5.4-mini has one). An
    // UNPRICED model is refused for text too since #4968 — see openai-budget-per-model.test.ts.
    process.env.OPENAI_MODEL = "gpt-5.5";
    stubFetch({ content: "from openai", usage: { prompt_tokens: 50, completion_tokens: 100 } });
    const r = await cascadeComplete(MESSAGES);
    expect(r?.provider).toBe("OpenAI");
  });

  it("a malformed usage block books the hold, not NaN (Codex r2 F8 on #4355 — the reservation sanitizes for every caller)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes("api.openai.com")
          ? Response.json({ choices: [{ message: { content: "from openai" } }], usage: { prompt_tokens: "bad", completion_tokens: -1 } })
          : Response.json({ choices: [{ message: { content: "from groq" } }] }),
      ),
    );
    const r = await cascadeComplete(MESSAGES);
    expect(r?.provider).toBe("OpenAI");
    expect(Number.isFinite(openAiRunBudget().spentUsd)).toBe(true);
    expect(openAiRunBudget().spentUsd).toBeGreaterThanOrEqual(0.0027 - 1e-9); // the 600-token output cap at 4.5 / Mtok
  });

  it("a served OpenAI call books the provider's ACTUAL usage, not the worst case", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "1";
    stubFetch({ content: "from openai", usage: { prompt_tokens: 50, completion_tokens: 100 } });
    const r = await cascadeComplete(MESSAGES);
    expect(r?.provider).toBe("OpenAI");
    expect(openAiRunBudget().spentUsd).toBeCloseTo(0.00045, 6); // 100 / 1e6 * 4.5
    expect(openAiRunBudget().calls).toBe(1);
  });

  it("at the cap, OpenAI is skipped WITHOUT a fetch and Groq answers (the cascade falls through)", async () => {
    // Cap fits one worst case ($0.0027) but not a second after a $0.00225 real spend.
    process.env.OPENAI_RUN_BUDGET_USD = "0.004";
    const calls = stubFetch({ content: "from openai", usage: { prompt_tokens: 0, completion_tokens: 500 } });
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("OpenAI");
    const second = await cascadeComplete(MESSAGES);
    expect(second).toMatchObject({ provider: "Groq", content: "from groq" });
    expect(hosts(calls)).toEqual(["api.openai.com", "api.groq.com"]);
    expect(openAiRunBudget().calls).toBe(1);
  });

  it("a failed OpenAI request (non-OK status) releases its hold: the next call may still use OpenAI", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0.004";
    const calls = stubFetch({ status: 500 });
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect(openAiRunBudget().spentUsd).toBe(0);
    expect(openAiRunBudget().calls).toBe(0);
    await cascadeComplete(MESSAGES);
    expect(hosts(calls)).toEqual(["api.openai.com", "api.groq.com", "api.openai.com", "api.groq.com"]);
  });

  it("a transport failure (timeout after the request was accepted) books the WORST CASE: repeated timeouts cannot spend past the cap", async () => {
    // Cap fits one worst case ($0.0027), not two. Every attempt throws before headers arrive.
    process.env.OPENAI_RUN_BUDGET_USD = "0.004";
    const calls = stubFetch({ throws: true });
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect(openAiRunBudget().spentUsd).toBeCloseTo(0.0027, 6);
    expect(openAiRunBudget().heldUsd).toBe(0);
    // Second and third attempts: OpenAI is no longer fetched at all; Groq still answers.
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect(hosts(calls)).toEqual(["api.openai.com", "api.groq.com", "api.groq.com", "api.groq.com"]);
  });

  it("concurrent callers are bounded by the HOLD: with room for one worst case, the second skips OpenAI while the first is still in flight", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0.004";
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const calls = stubFetch({ content: "from openai", usage: { prompt_tokens: 0, completion_tokens: 10 } }, gate);
    const first = cascadeComplete(MESSAGES);
    const second = cascadeComplete(MESSAGES);
    // Let the second caller reach its provider decision before the first response lands.
    await new Promise((r) => setTimeout(r, 0));
    expect(hosts(calls)).toEqual(["api.openai.com", "api.groq.com"]);
    open();
    expect((await first)?.provider).toBe("OpenAI");
    expect((await second)?.provider).toBe("Groq");
    // The first call's hold was replaced by its tiny actual usage.
    expect(openAiRunBudget().spentUsd).toBeCloseTo(0.000045, 7);
  });

  it("token-dense input is held at its UPPER bound: a cap the chars/4 average would have passed refuses BEFORE the fetch (Codex r3 F4)", async () => {
    // Input priced, output (almost) free, so only the input hold decides. 100 × "故障代码" = 400 CJK
    // chars ≈ 1,200 UTF-8 bytes: the byte bound is about 1,230 tokens, chars/4 about 110.
    process.env.OPENAI_PRICE_PER_MTOK_IN = "1000";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "0.000001"; // not "0": a zero price falls back to the default
    process.env.OPENAI_RUN_BUDGET_USD = "0.5"; // 500 tokens' worth: above the average, below the bound
    resetOpenAiRunBudgetForTests();
    const dense = [{ role: "user" as const, content: "故障代码".repeat(100) }];
    const calls = stubFetch({ content: "from openai", usage: { prompt_tokens: 1200, completion_tokens: 10 } });
    expect((await cascadeComplete(dense))?.provider).toBe("Groq");
    expect(hosts(calls)).toEqual(["api.groq.com"]); // OpenAI never fetched
    expect(openAiRunBudget().calls).toBe(0);
    // Control: a plain ASCII question of the same shape fits under the same cap and is served.
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("OpenAI");
  });

  it("an unknown outcome on token-dense input is charged at the UPPER bound, not the average", async () => {
    process.env.OPENAI_PRICE_PER_MTOK_IN = "1000";
    process.env.OPENAI_PRICE_PER_MTOK_OUT = "0";
    process.env.OPENAI_RUN_BUDGET_USD = "10";
    resetOpenAiRunBudgetForTests();
    const dense = [{ role: "user" as const, content: "故障代码".repeat(100) }];
    stubFetch({ throws: true });
    expect((await cascadeComplete(dense))?.provider).toBe("Groq");
    const bytes = Buffer.byteLength(JSON.stringify(dense), "utf8");
    expect(openAiRunBudget().spentUsd).toBeGreaterThanOrEqual(bytes / 1e6 * 1000);
  });

  it("control: the budget never touches a free-tier provider (no key → Groq only, nothing recorded)", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_RUN_BUDGET_USD = "0";
    const calls = stubFetch({ content: "unused" });
    expect((await cascadeComplete(MESSAGES))?.provider).toBe("Groq");
    expect(hosts(calls)).toEqual(["api.groq.com"]);
    expect(openAiRunBudget().calls).toBe(0);
  });
});
