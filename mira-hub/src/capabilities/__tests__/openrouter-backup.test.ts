/**
 * OpenRouter is the Hub's backup tier behind OpenAI (owner decision 2026-10-14) — offline contract.
 *
 * Groq (400 overdue) and Together (402) died on unpaid bills, so OpenAI was the
 * only live provider. OpenRouter is one prepaid account in front of many hosts.
 * Mirrors mira-bots/tests/test_openrouter_backup.py so the two runtimes agree:
 *   - order: right after OpenAI, key-gated (no key → list exactly as before);
 *   - model: non-reasoning Llama 3.3 70B (compat dialect);
 *   - data policy: every request asks for hosts that neither train on nor retain
 *     prompts (`provider: {data_collection: "deny", zdr: true}`), on EVERY
 *     consumer path — requestDialectFields is the one shaper, and the two chat
 *     routes that re-map the registry must carry the field through;
 *   - no Claude: OpenRouter can serve Anthropic (also via `~anthropic/...`
 *     aliases and `openrouter/...` auto-routers) — such a model drops the provider.
 *   - no `:free`: customer-facing primary / backup / pool members pointed at an
 *     OpenRouter free id are dropped the same way.
 *
 * Run: npx vitest run src/capabilities/__tests__/openrouter-backup.test.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRequestBody,
  canonicalProviders,
  estimateCostUsd,
  requestDialectFields,
} from "@/lib/inference/canonical-cascade";
import { cascadeComplete } from "@/lib/llm/cascade";

const ENV = { ...process.env };
const ROUTING = { data_collection: "deny", zdr: true };
const CLEAR = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_CLASSIFIER_MODEL",
  "OPENAI_REASONING_EFFORT",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "GROQ_CLASSIFIER_MODEL",
  "CEREBRAS_API_KEY",
  "CEREBRAS_MODEL",
  "CEREBRAS_CLASSIFIER_MODEL",
  "TOGETHERAI_API_KEY",
  "TOGETHERAI_MODEL",
  "TOGETHERAI_CLASSIFIER_MODEL",
];
beforeEach(() => {
  for (const k of CLEAR) delete process.env[k];
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const names = () => canonicalProviders().map((p) => p.name);
const REFUSED = [
  "anthropic/claude-sonnet-4.5",
  "Anthropic/Claude-Opus-4.1",
  "~anthropic/claude-sonnet-latest",
  "openrouter/auto",
  "openrouter/free",
  // Presets (Codex r1 F1 on #4436): selected remotely, so never accepted.
  "@preset/backup",
  "meta-llama/llama-3.3-70b-instruct@preset/backup",
  // OpenRouter :free hosts are unpaid community endpoints, not a customer SLA.
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

describe("canonical cascade — OpenRouter backup tier", () => {
  it("sits right after OpenAI", () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.OPENROUTER_API_KEY = "kr";
    expect(names()).toEqual(["OpenAI", "OpenRouter", "Groq", "Cerebras", "Together"]);
  });

  it("is absent without its key — the list is exactly as before", () => {
    process.env.OPENAI_API_KEY = "k0";
    expect(names()).toEqual(["OpenAI", "Groq", "Cerebras", "Together"]);
  });

  it("calls OpenRouter with the non-reasoning Llama default and the data policy", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    const [or] = canonicalProviders();
    expect(or).toMatchObject({
      name: "OpenRouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: "kr",
      model: "meta-llama/llama-3.3-70b-instruct",
      providerRouting: ROUTING,
    });
    expect(or.requestStyle ?? "openai-compat").toBe("openai-compat");
  });

  it("an empty OPENROUTER_MODEL (compose ${VAR:-}) keeps the default", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    process.env.OPENROUTER_MODEL = "";
    expect(canonicalProviders()[0].model).toBe("meta-llama/llama-3.3-70b-instruct");
  });

  it("control: an allowed model is honoured", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    process.env.OPENROUTER_MODEL = "openai/gpt-oss-120b";
    expect(canonicalProviders()[0]).toMatchObject({ name: "OpenRouter", model: "openai/gpt-oss-120b" });
  });

  it.each(REFUSED)("refuses %s — the provider is dropped, never served as Claude", (model) => {
    process.env.OPENROUTER_API_KEY = "kr";
    process.env.OPENROUTER_MODEL = model;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(names()).not.toContain("OpenRouter");
    expect(err.mock.calls.flat().join(" ")).toContain("OPENROUTER_MODEL_REFUSED");
  });
});

describe("canonical cascade — :free models drop primary/pool members", () => {
  const allKeys = () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.OPENROUTER_API_KEY = "kr";
    process.env.GROQ_API_KEY = "k1";
    process.env.CEREBRAS_API_KEY = "k2";
    process.env.TOGETHERAI_API_KEY = "k3";
  };

  it.each([
    ["OPENAI_MODEL", "OpenAI", "meta-llama/llama-3.3-70b-instruct:free"],
    ["GROQ_MODEL", "Groq", "meta-llama/llama-3.3-70b-instruct:free"],
    ["CEREBRAS_MODEL", "Cerebras", "gpt-oss-120b:free"],
    ["TOGETHERAI_MODEL", "Together", "meta-llama/Llama-3.3-70B-Instruct-Turbo:free"],
  ] as const)("%s=:free drops %s", (env, dropped, model) => {
    allKeys();
    process.env[env] = model;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(names()).not.toContain(dropped);
    expect(err.mock.calls.flat().join(" ")).toContain("OPENROUTER_MODEL_REFUSED");
  });

  it("control: a paid llama id stays on backup and pool", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    process.env.GROQ_API_KEY = "k1";
    process.env.OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct";
    process.env.GROQ_MODEL = "meta-llama/llama-3.3-70b-instruct";
    expect(names()).toEqual(["OpenRouter", "Groq", "Cerebras", "Together"]);
    expect(canonicalProviders().find((p) => p.name === "OpenRouter")?.model).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
    expect(canonicalProviders().find((p) => p.name === "Groq")?.model).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
  });
});

describe("request body — the data policy rides on every consumer path", () => {
  it("requestDialectFields adds it for OpenRouter", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    const [or] = canonicalProviders();
    expect(requestDialectFields(or, 500, 0.4)).toEqual({
      max_tokens: 500,
      temperature: 0.4,
      provider: ROUTING,
    });
  });

  it("buildRequestBody (notebook chat) carries it too", () => {
    process.env.OPENROUTER_API_KEY = "kr";
    const [or] = canonicalProviders();
    expect(buildRequestBody(or, [{ role: "user", content: "hi" }], 300)).toMatchObject({
      model: "meta-llama/llama-3.3-70b-instruct",
      max_tokens: 300,
      provider: ROUTING,
    });
  });

  it("control: Groq's dialect fields are unchanged", () => {
    process.env.GROQ_API_KEY = "k1";
    const [groq] = canonicalProviders();
    expect(groq.name).toBe("Groq");
    expect(requestDialectFields(groq, 500, 0.4)).toEqual({ max_tokens: 500, temperature: 0.4 });
  });

  const HUB = resolve(__dirname, "..", "..");
  it.each(["app/api/assets/[id]/chat/route.ts", "app/api/namespace/node/[id]/chat/route.ts"])(
    "%s carries providerRouting when it re-maps the registry",
    (rel) => {
      // These routes copy provider fields one by one; a field they don't copy
      // never reaches requestDialectFields, so the data policy would be dropped.
      const src = readFileSync(resolve(HUB, rel), "utf8");
      expect(src).toContain("providerRouting: p.providerRouting");
    },
  );
});

type Call = { url: string; body: Record<string, unknown>; auth: string | undefined };

function stubFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: u,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: headers.Authorization,
      });
      if (u.includes("api.openai.com")) return new Response("credit", { status: 402 });
      return Response.json({ choices: [{ message: { content: "from openrouter" } }] });
    }),
  );
  return calls;
}

const MESSAGES = [{ role: "user" as const, content: "PowerFlex 525 fault F0004 on power-up" }];

describe("lib/llm/cascade — OpenRouter backs up OpenAI", () => {
  it("an OpenAI 402 falls through to OpenRouter, which answers with the data policy set", async () => {
    process.env.OPENAI_API_KEY = "k0";
    process.env.OPENROUTER_API_KEY = "kr";
    const calls = stubFetch();
    const r = await cascadeComplete(MESSAGES, { maxTokens: 500, temperature: 0.2 });
    expect(r).toMatchObject({ provider: "OpenRouter", content: "from openrouter" });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.openai.com", "openrouter.ai"]);
    expect(calls[1].auth).toBe("Bearer kr");
    expect(calls[1].body).toMatchObject({
      model: "meta-llama/llama-3.3-70b-instruct",
      max_tokens: 500,
      temperature: 0.2,
      provider: ROUTING,
    });
  });

  it.each(["anthropic/claude-haiku-4.5", "@preset/backup", "meta-llama/llama-3.3-70b-instruct:free"])(
    "a refused model (%s) leaves OpenRouter out of the classifier cascade too",
    async (model) => {
      process.env.OPENROUTER_API_KEY = "kr";
      process.env.OPENROUTER_MODEL = model;
      process.env.GROQ_API_KEY = "k1";
      vi.spyOn(console, "error").mockImplementation(() => {});
      const calls = stubFetch();
      await cascadeComplete(MESSAGES, { maxTokens: 100 });
      expect(calls.some((c) => c.url.includes("openrouter.ai"))).toBe(false);
    },
  );

  it("classifier cascade skips a :free Groq member", async () => {
    process.env.GROQ_API_KEY = "k1";
    process.env.CEREBRAS_API_KEY = "k2";
    process.env.GROQ_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = stubFetch();
    await cascadeComplete(MESSAGES, { maxTokens: 100 });
    expect(calls.some((c) => c.url.includes("api.groq.com"))).toBe(false);
    expect(calls.some((c) => c.url.includes("api.cerebras.ai"))).toBe(true);
  });
});

describe("cost estimate", () => {
  it("OpenRouter is metered — priced, never null or 0", () => {
    const c = estimateCostUsd("OpenRouter", 1_000_000, 0, 1_000_000);
    expect(c).not.toBeNull();
    expect(c).toBeGreaterThan(0);
  });
});
