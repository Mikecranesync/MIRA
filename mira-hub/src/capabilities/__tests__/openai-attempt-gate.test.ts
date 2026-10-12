// The per-run OpenAI spend hard stop covers EVERY Hub path that can reach OpenAI
// (#4355). Two layers:
//
//  1. reserveOpenAiAttempt — the one gate a provider attempt passes before its
//     fetch — and the safety judge, behaviourally. A judge refusal has a safety
//     meaning: the route serves an "unknown" answer with NO hazard banner
//     (fail-open, owner decision #4022), so the judge must still try every
//     other provider and must name the budget as the reason when it gives up.
//  2. A DEFAULT-DENY source scan: any non-test Hub file that fetches a canonical
//     provider (or names OpenAI's endpoint, or builds the OpenAI vision provider)
//     must go through the gate or `reserve`. Review rounds kept finding "one more
//     call site"; this makes the class mechanically closed. The scanner is
//     unit-tested against fixtures so a green run means something.
//     Known blind spots (it reports what it can see): the check is per FILE,
//     so a second, ungated fetch added to an already-gated file passes; and a
//     fetch made inside a helper defined in another file, fed a provider URL,
//     is invisible to it. Review still owns those two cases.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/openai-attempt-gate

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiRunBudget,
  boundInputTokens,
  openAiRunBudget,
  reserveOpenAiAttempt,
  resetOpenAiRunBudgetForTests,
} from "../openai-run-budget";
import { semanticSafetyCheck } from "../answer-safety-check";

const ENV = { ...process.env };
const usd = (i: number, o: number) => new OpenAiRunBudget({ now: () => 0 }).estimateUsd(i, o);

beforeEach(() => {
  for (const k of ["OPENAI_RUN_BUDGET_USD", "OPENAI_RUN_BUDGET_WINDOW_S", "OPENAI_PRICE_PER_MTOK_IN", "OPENAI_PRICE_PER_MTOK_OUT", "OPENAI_MODEL"]) {
    delete process.env[k];
  }
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.TOGETHERAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.OPENAI_API_KEY = "k0";
  resetOpenAiRunBudgetForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...ENV };
  resetOpenAiRunBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reserveOpenAiAttempt — the one gate", () => {
  it("a free provider passes with no hold", () => {
    const g = reserveOpenAiAttempt("Groq", "t", 1_000, 100);
    expect(g).toEqual({ ok: true, reservation: null });
    expect(openAiRunBudget().heldUsd).toBe(0);
  });
  it("OpenAI within the cap holds the worst case until decided", () => {
    const g = reserveOpenAiAttempt("OpenAI", "t", 1_000, 100);
    if (!g.ok || !g.reservation) throw new Error("precondition: OpenAI is admitted under the default cap");
    expect(openAiRunBudget().heldUsd).toBeCloseTo(usd(1_000, 100), 12);
    g.reservation.release();
    expect(openAiRunBudget().heldUsd).toBe(0);
  });
  it("OpenAI past the cap is refused and logged with its scope", () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0";
    resetOpenAiRunBudgetForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(reserveOpenAiAttempt("OpenAI", "safety-judge", 1_000, 100)).toEqual({ ok: false });
    expect(warn.mock.calls.flat().join(" ")).toContain('"scope":"safety-judge"');
  });
});

describe("the safety judge under the cap — skips OpenAI, still tries every other provider", () => {
  const judge = () => semanticSafetyCheck({ question: "q", answerText: "a", general: false, selectedClass: "pressure" });
  const okVerdict = (usage?: unknown) =>
    Response.json({ choices: [{ message: { content: '{"verdict":"safe","hazard_class":"none","reason":"x"}' } }], usage });

  it("past the cap OpenAI is never fetched; a free provider still judges", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0";
    process.env.GROQ_API_KEY = "k1";
    resetOpenAiRunBudgetForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => okVerdict());
    vi.stubGlobal("fetch", fetchMock);
    expect((await judge()).verdict).toBe("safe");
    expect(fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))).not.toContain("https://api.openai.com/v1/chat/completions");
  });

  it("past the cap with no other provider: UNKNOWN, reason names the budget, nothing is sent", async () => {
    process.env.OPENAI_RUN_BUDGET_USD = "0";
    resetOpenAiRunBudgetForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => okVerdict());
    vi.stubGlobal("fetch", fetchMock);
    expect(await judge()).toEqual({ verdict: "unknown", hazardClass: "pressure", reason: "openai_budget_exhausted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a served OpenAI verdict books its actual usage and holds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okVerdict({ prompt_tokens: 30, completion_tokens: 12 })));
    expect((await judge()).verdict).toBe("safe");
    expect(openAiRunBudget().spentUsd).toBeCloseTo(usd(30, 12), 12);
    expect(openAiRunBudget().heldUsd).toBe(0);
  });

  it("a 200 whose JSON is null books the worst case, holds nothing, and returns UNKNOWN", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));
    expect((await judge()).verdict).toBe("unknown");
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBeGreaterThanOrEqual(usd(0, 200));
  });

  it("a rejection (non-2xx) releases the hold and books nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    // Control: no budget refusal happened, so the reason must NOT blame the budget.
    expect(await judge()).toEqual({ verdict: "unknown", hazardClass: "pressure", reason: "no_provider_verdict" });
    expect(openAiRunBudget().heldUsd).toBe(0);
    expect(openAiRunBudget().spentUsd).toBe(0);
  });
});

// ── default-deny: every Hub provider fetch is gated ─────────────────────────

/** A file reaches a provider if it fetches AND names a provider source. */
const REACHES_PROVIDER = /\bcanonicalProviders\(\)|api\.openai\.com|\bopenAiVisionProvider\(/;
const FETCHES = /\bawait fetch\(|\bfetch\(/;
const GATED = /\breserveOpenAiAttempt\(|openAiRunBudget\(\)\.reserve\(/;
/** Defines the provider list itself; it never fetches. */
const ALLOW = new Set(["src/lib/inference/canonical-cascade.ts"]);

function ungatedProviderFetchers(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([path, src]) => !ALLOW.has(path) && REACHES_PROVIDER.test(src) && FETCHES.test(src) && !GATED.test(src))
    .map(([path]) => path)
    .sort();
}

function hubSources(): Record<string, string> {
  const root = resolve(__dirname, "../.."); // mira-hub/src
  const hub = resolve(root, "..");
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out[relative(hub, full)] = readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return out;
}

describe("default-deny — no Hub file fetches a provider without the budget gate", () => {
  it("the real tree has no ungated provider fetcher", () => {
    const files = hubSources();
    // Preconditions: the scan sees the known OpenAI paths, so an empty result means something.
    for (const known of [
      "src/app/api/equipment-notebooks/[id]/chat/route.ts",
      "src/app/api/assets/[id]/chat/route.ts",
      "src/app/api/namespace/node/[id]/chat/route.ts",
      "src/app/api/reports/generate/route.ts",
      "src/capabilities/answer-safety-check.ts",
      "src/lib/llm/cascade.ts",
      "src/lib/nameplate/index.ts",
      "src/lib/nameplate/passes.ts",
    ]) {
      expect(files[known], known).toBeDefined();
      expect(REACHES_PROVIDER.test(files[known]) || /openAiVisionCall/.test(files[known]), known).toBe(true);
    }
    expect(ungatedProviderFetchers(files)).toEqual([]);
  });

  it("control: the scanner flags an ungated fetcher and passes a gated one", () => {
    const ungated = 'for (const p of canonicalProviders()) { const r = await fetch(p.url, {}); }';
    const gated = 'for (const p of canonicalProviders()) { const g = reserveOpenAiAttempt(p.name, "x", 1, 1); const r = await fetch(p.url, {}); }';
    const noFetch = "export function canonicalProviders() { return []; }";
    expect(ungatedProviderFetchers({ "a.ts": ungated, "b.ts": gated, "c.ts": noFetch })).toEqual(["a.ts"]);
    expect(boundInputTokens([{ role: "user", content: "x" }])).toBeGreaterThan(0); // the bound the gate is sized by
  });
});
