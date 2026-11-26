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

/**
 * #6022: per-attempt accounting. `cascadeComplete` settles the run budget for an
 * attempt that may have been billed (a 200 with empty content, a timeout, an
 * unreadable body) and then returns null for it, so only an attempt that produced
 * text reaches the caller's usage. The contract below delivers every contacted
 * attempt through ONE optional collector in opts; the six callers that pass no
 * collector keep today's result shape and null-on-exhaustion (controls at the end).
 *
 * Proposed names (the implementer adopts them or changes them here, in one place):
 *   opts[ON_ATTEMPT](attempt), called once per provider actually contacted, in order;
 *   attempt = { provider, model, billed, usage }:
 *     billed false = rejected before generation (non-2xx), usage null;
 *     billed true + usage counts = served (with or without text), actual counts;
 *     billed true + usage null = unresolved (timeout, unreadable body): the caller
 *       must treat the turn's totals as unknown.
 */
const ON_ATTEMPT = "onAttempt";
type AttemptRecord = { provider: string; model: string; billed: boolean; usage: { prompt_tokens?: number; completion_tokens?: number } | null };

describe("#6022 F5 — every contacted attempt reaches the caller", () => {
  beforeEach(() => {
    // Pinned: an inherited budget would refuse OpenAI before the fetch and change why these fail.
    delete process.env.OPENAI_RUN_BUDGET_USD;
    resetOpenAiRunBudgetForTests();
  });
  const P = (name: string, url: string) => ({
    name,
    url,
    key: "k",
    model: name === "OpenAI" ? "gpt-5.4-mini" : `m-${name}`,
    requestStyle: name === "OpenAI" ? ("openai-reasoning" as const) : undefined,
  });
  const OPENAI = P("OpenAI", "https://api.openai.com/v1/chat/completions");
  const GROQ = P("Groq", "https://api.groq.com/openai/v1/chat/completions");
  type Reply = { status?: number; content?: string; usage?: unknown; throws?: boolean; badBody?: boolean };
  function stubHosts(byHost: Record<string, Reply>) {
    const bodies: Array<{ host: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const host = new URL(String(url)).host;
        bodies.push({ host, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        const r = byHost[host];
        if (r.throws) throw new DOMException("timed out", "TimeoutError");
        if (r.status && r.status !== 200) return new Response("down", { status: r.status });
        if (r.badBody) return new Response("{not json", { status: 200 });
        return Response.json({ choices: [{ message: { content: r.content ?? "" }, finish_reason: "stop" }], usage: r.usage });
      }),
    );
    return bodies;
  }
  /** The collector goes through a variable so this tests-only commit still type-checks before the option exists. */
  function withCollector(base: Record<string, unknown>) {
    const seen: AttemptRecord[] = [];
    const opts = { ...base, [ON_ATTEMPT]: (a: AttemptRecord) => seen.push(a) } as Parameters<typeof cascadeComplete>[1];
    return { seen, opts };
  }
  const brief = (a: AttemptRecord) => ({ provider: a.provider, billed: a.billed, usage: a.usage });

  it("F5-a: a 200 with empty content and known usage is reported as billed with its counts when the cascade is exhausted", async () => {
    stubHosts({ "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 300 } } });
    const { seen, opts } = withCollector({ providers: [OPENAI], maxTokens: 300 });
    expect(await cascadeComplete(MESSAGES, opts)).toBeNull();
    expect(seen.map(brief)).toEqual([{ provider: "OpenAI", billed: true, usage: { prompt_tokens: 50, completion_tokens: 300 } }]);
  });

  it("F5-a: a billed empty first attempt is reported alongside the fallback that served", async () => {
    stubHosts({
      "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 30 } },
      "api.groq.com": { content: "ok", usage: { prompt_tokens: 50, completion_tokens: 20 } },
    });
    const { seen, opts } = withCollector({ providers: [OPENAI, GROQ], maxTokens: 300 });
    expect((await cascadeComplete(MESSAGES, opts))?.provider).toBe("Groq");
    expect(seen.map(brief)).toEqual([
      { provider: "OpenAI", billed: true, usage: { prompt_tokens: 50, completion_tokens: 30 } },
      { provider: "Groq", billed: true, usage: { prompt_tokens: 50, completion_tokens: 20 } },
    ]);
  });

  it("F5-b: a timeout is reported as billed with unknown usage", async () => {
    stubHosts({ "api.groq.com": { throws: true } });
    const { seen, opts } = withCollector({ providers: [GROQ] });
    expect(await cascadeComplete(MESSAGES, opts)).toBeNull();
    expect(seen.map(brief)).toEqual([{ provider: "Groq", billed: true, usage: null }]);
  });

  it("F5-b: a 200 whose body cannot be read is reported as billed with unknown usage", async () => {
    stubHosts({ "api.groq.com": { badBody: true } });
    const { seen, opts } = withCollector({ providers: [GROQ] });
    expect(await cascadeComplete(MESSAGES, opts)).toBeNull();
    expect(seen.map(brief)).toEqual([{ provider: "Groq", billed: true, usage: null }]);
  });

  it("F3 (Codex r1 on #6081): a gateway 504 is ambiguous, so it is reported as billed with unknown usage", async () => {
    stubHosts({ "api.groq.com": { status: 504 } });
    const { seen, opts } = withCollector({ providers: [GROQ] });
    expect(await cascadeComplete(MESSAGES, opts)).toBeNull();
    expect(seen.map(brief)).toEqual([{ provider: "Groq", billed: true, usage: null }]);
  });

  it("F5: an HTTP 500 before generation is reported as not billed", async () => {
    stubHosts({ "api.groq.com": { status: 500 } });
    const { seen, opts } = withCollector({ providers: [GROQ] });
    expect(await cascadeComplete(MESSAGES, opts)).toBeNull();
    expect(seen.map(brief)).toEqual([{ provider: "Groq", billed: false, usage: null }]);
  });

  it("control (the six other callers): with no collector, an empty first response falls through to the backup with the same cap", async () => {
    const bodies = stubHosts({
      "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 300 } },
      "api.groq.com": { content: "ok", usage: { prompt_tokens: 50, completion_tokens: 20 } },
    });
    const r = await cascadeComplete(MESSAGES, { providers: [OPENAI, GROQ], maxTokens: 300 });
    expect(bodies.map((b) => [b.host, b.body.max_completion_tokens ?? b.body.max_tokens])).toEqual([
      ["api.openai.com", 300],
      ["api.groq.com", 300],
    ]);
    expect(r).toMatchObject({ provider: "Groq", content: "ok", model: "m-Groq", usage: { prompt_tokens: 50, completion_tokens: 20 } });
  });

  it("control (the six other callers): with no collector, exhaustion still returns null", async () => {
    stubHosts({ "api.openai.com": { content: "", usage: { prompt_tokens: 50, completion_tokens: 300 } }, "api.groq.com": { status: 500 } });
    expect(await cascadeComplete(MESSAGES, { providers: [OPENAI, GROQ], maxTokens: 300 })).toBeNull();
  });
});

/** Round 2 (review r1, mutation CM1): the non-object-JSON 200 report. */
describe("R1-C3 CM1 — a 200 whose JSON is not an object is reported as billed with unknown usage", () => {
  beforeEach(() => {
    delete process.env.OPENAI_RUN_BUDGET_USD;
    resetOpenAiRunBudgetForTests();
  });
  const GROQ = { name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", key: "k", model: "m-Groq" };

  it("a 200 with the JSON literal null: one attempt, billed true, usage null, and the cascade returns null", async () => {
    const fetchMock = vi.fn(async () => new Response("null", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: Array<{ provider: string; billed: boolean; usage: unknown }> = [];
    const r = await cascadeComplete(MESSAGES, {
      providers: [GROQ],
      onAttempt: (a) => seen.push({ provider: a.provider, billed: a.billed, usage: a.usage }),
    } as Parameters<typeof cascadeComplete>[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toBeNull();
    expect(seen).toEqual([{ provider: "Groq", billed: true, usage: null }]);
  });
});
