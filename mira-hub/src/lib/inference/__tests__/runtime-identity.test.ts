// #4507 — Hub runtime identity for the Stranger Walk (F1/F2 follow-up of #4461).
//
// `deploymentGeneration` changes on every container recreate, even from the same
// image, so a walk can tell a same-image redeploy or an A→B→A rollback apart
// from "nothing happened". `inferenceFingerprint` is a hash plus a readable
// summary of the EFFECTIVE cascade (providers, models, output cap, accounting
// rates), so the walk can price its budget from what the Hub really bills with
// instead of its own Doppler snapshot. Neither may carry a secret.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deploymentGeneration, inferenceFingerprint } from "../runtime-identity";

const saved = { ...process.env };

// Pinned, never inherited (prove-the-test-fails rule 6). The canonical seam is
// ON here so the OpenAI-shaped assertions below exercise the canonical cascade;
// the #5048 block sets it per test.
function baseline() {
  process.env = { ...saved };
  for (const k of [
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_CLASSIFIER_MODEL",
    "OPENAI_PRICE_PER_MTOK_IN",
    "OPENAI_PRICE_PER_MTOK_OUT",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "CEREBRAS_API_KEY",
    "TOGETHERAI_API_KEY",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "MIRA_TURN_MAX_OUTPUT_TOKENS",
    "MIRA_JEV_SHADOW",
    "MIRA_JEV_DECISION",
    "NOTEBOOK_QUERY_REWRITE",
    "NOTEBOOK_SEMANTIC_CHECK",
  ]) {
    delete process.env[k];
  }
  process.env.MIRA_CANONICAL_SEAM = "1";
}

beforeEach(baseline);
afterEach(() => {
  process.env = { ...saved };
});

describe("deploymentGeneration", () => {
  it("is one stable id for the life of the process", () => {
    const a = deploymentGeneration();
    const b = deploymentGeneration();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });

  it("starts with the process boot instant so generations order by time", () => {
    const gen = deploymentGeneration();
    const bootIso = gen.slice(0, 24);
    const boot = Date.parse(bootIso);
    expect(Number.isFinite(boot)).toBe(true);
    // Booted before now, and not before this test file could possibly have been
    // written (guards against a constant or a zero timestamp).
    expect(boot).toBeLessThanOrEqual(Date.now());
    expect(boot).toBeGreaterThan(Date.parse("2026-10-01T00:00:00Z"));
    // A random suffix separates two containers booted in the same millisecond.
    expect(gen.slice(24)).toMatch(/^-[0-9a-f]{8,}$/);
  });
});

describe("inferenceFingerprint", () => {
  it("hash is sha256 of the canonical summary, so the summary alone reproduces it", () => {
    const fp = inferenceFingerprint();
    const expected = createHash("sha256").update(JSON.stringify(fp.summary)).digest("hex").slice(0, 16);
    expect(fp.hash).toBe(expected);
    expect(inferenceFingerprint().hash).toBe(fp.hash);
  });

  it("lists the effective providers in cascade order with model and accounting rate", () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    process.env.OPENROUTER_API_KEY = "or-test-not-a-real-key";
    const { summary } = inferenceFingerprint();
    expect(summary.providers[0]).toEqual({
      name: "OpenAI",
      model: "gpt-5.4-mini",
      pricePerMtok: { input: 0.75, cached_input: 0.075, output: 4.5 },
    });
    expect(summary.providers.map((p) => p.name)).toEqual(["OpenAI", "OpenRouter"]);
    expect(summary.maxOutputTokens).toBe(4000);
    expect(summary.canonicalSeam).toBe(true);
  });

  // Codex round 1 on #5047, F1 (#5048): the fingerprint must describe the
  // cascade the notebook route DISPATCHES — the legacy registry when the seam
  // is off (the production default), the canonical one when on — and only the
  // entries dispatch can reach (it skips every keyless provider).
  describe("describes the cascade the notebook route dispatches (#5048)", () => {
    it("seam off with only a Gemini key: the legacy registry's Gemini, nothing else", () => {
      process.env.MIRA_CANONICAL_SEAM = "0";
      process.env.GEMINI_API_KEY = "gm-test-not-a-real-key";
      const { summary } = inferenceFingerprint();
      expect(summary.canonicalSeam).toBe(false);
      expect(summary.providers).toEqual([{ name: "Gemini", model: "gemini-2.5-flash", pricePerMtok: null }]);
    });

    it("seam on with only an OpenAI key: OpenAI, nothing else", () => {
      process.env.MIRA_CANONICAL_SEAM = "1";
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const { summary } = inferenceFingerprint();
      expect(summary.providers.map((p) => p.name)).toEqual(["OpenAI"]);
    });

    it("seam off ignores an OpenAI key the legacy registry never dispatches", () => {
      process.env.MIRA_CANONICAL_SEAM = "0";
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.GROQ_API_KEY = "gsk-test-not-a-real-key";
      const { summary } = inferenceFingerprint();
      expect(summary.providers.map((p) => p.name)).toEqual(["Groq"]);
    });

    it("with no key at all the summary lists no provider (control: adding one key adds one provider)", () => {
      process.env.MIRA_CANONICAL_SEAM = "1";
      expect(inferenceFingerprint().summary.providers).toEqual([]);
      process.env.GROQ_API_KEY = "gsk-test-not-a-real-key";
      expect(inferenceFingerprint().summary.providers.map((p) => p.name)).toEqual(["Groq"]);
    });
  });

  // Codex round 1 on #5047, F2 (#5049): NOTEBOOK_QUERY_REWRITE=1 adds a paid
  // cascade call (200 output tokens, classifier model) before retrieval.
  describe("exposes the paid query-rewrite lane (#5049)", () => {
    it("is reported off, with no lane detail, when NOTEBOOK_QUERY_REWRITE is unset", () => {
      const { summary } = inferenceFingerprint();
      expect(summary.optionalMetered.queryRewrite).toEqual({ enabled: false });
    });

    it("enabling it changes the hash and exposes the lane's providers, model, cap and rate", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENAI_MODEL = "gpt-5.4-mini";
      const before = inferenceFingerprint().hash;
      process.env.NOTEBOOK_QUERY_REWRITE = "1";
      const after = inferenceFingerprint();
      expect(after.hash).not.toBe(before);
      expect(after.summary.optionalMetered.queryRewrite).toEqual({
        enabled: true,
        maxOutputTokens: 200,
        providers: [
          {
            name: "OpenAI",
            model: "gpt-5.4-mini",
            pricePerMtok: { input: 0.75, cached_input: 0.075, output: 4.5 },
          },
        ],
      });
    });

    it("with it enabled, changing only OPENAI_CLASSIFIER_MODEL changes the hash and the reported model", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.NOTEBOOK_QUERY_REWRITE = "1";
      const before = inferenceFingerprint();
      process.env.OPENAI_CLASSIFIER_MODEL = "gpt-5.4-nano";
      const after = inferenceFingerprint();
      expect(after.hash).not.toBe(before.hash);
      const lane = after.summary.optionalMetered.queryRewrite;
      expect(lane.enabled && lane.providers[0].model).toBe("gpt-5.4-nano");
      // The main turn still names its own model: the classifier override is the lane's alone.
      expect(after.summary.providers[0].model).toBe(before.summary.providers[0].model);
    });

    it("with it disabled, the classifier model does not move the hash (control)", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      const before = inferenceFingerprint().hash;
      process.env.OPENAI_CLASSIFIER_MODEL = "gpt-5.4-nano";
      expect(inferenceFingerprint().hash).toBe(before);
    });
  });

  it("changes when the serving model changes", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    const before = inferenceFingerprint().hash;
    process.env.OPENAI_MODEL = "gpt-5.4";
    expect(inferenceFingerprint().hash).not.toBe(before);
  });

  it("changes when a provider is enabled by its key", () => {
    const before = inferenceFingerprint().hash;
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    expect(inferenceFingerprint().hash).not.toBe(before);
  });

  it("changes when the output cap changes", () => {
    const before = inferenceFingerprint().hash;
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "1200";
    const after = inferenceFingerprint();
    expect(after.hash).not.toBe(before);
    expect(after.summary.maxOutputTokens).toBe(1200);
  });

  it("changes when the OpenAI accounting rate is overridden", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    const before = inferenceFingerprint().hash;
    process.env.OPENAI_PRICE_PER_MTOK_IN = "9.5";
    const after = inferenceFingerprint();
    expect(after.hash).not.toBe(before);
    expect(after.summary.providers[0].pricePerMtok).toEqual({
      input: 9.5,
      cached_input: 0.075,
      output: 4.5,
    });
  });

  it("changes when the canonical seam or an optional metered lane is switched", () => {
    const base = inferenceFingerprint().hash;
    process.env.MIRA_CANONICAL_SEAM = "0";
    const seam = inferenceFingerprint();
    expect(seam.hash).not.toBe(base);
    expect(seam.summary.canonicalSeam).toBe(false);
    process.env.MIRA_CANONICAL_SEAM = "1";
    process.env.MIRA_JEV_SHADOW = "1";
    const jev = inferenceFingerprint();
    expect(jev.hash).not.toBe(base);
    expect(jev.summary.optionalMetered).toEqual({
      jevShadow: true,
      jevDecision: false,
      queryRewrite: { enabled: false },
      safetyJudge: { enabled: true, maxOutputTokens: 200, providers: [] },
    });
  });

  it("does not change when only a secret's value changes", () => {
    process.env.OPENAI_API_KEY = "sk-test-aaaa";
    process.env.GROQ_API_KEY = "gsk-aaaa";
    const before = inferenceFingerprint().hash;
    process.env.OPENAI_API_KEY = "sk-test-bbbb";
    process.env.GROQ_API_KEY = "gsk-bbbb";
    expect(inferenceFingerprint().hash).toBe(before);
  });

  it("carries no secret value, URL, or key-bearing field in the summary", () => {
    process.env.OPENAI_API_KEY = "sk-test-hunter2";
    process.env.OPENROUTER_API_KEY = "or-hunter3";
    process.env.GROQ_API_KEY = "gsk-hunter4";
    const text = JSON.stringify(inferenceFingerprint());
    for (const s of ["hunter2", "hunter3", "hunter4", "https://", "key"]) {
      expect(text).not.toContain(s);
    }
  });

  // Codex round 2 on #5047, F1: the OpenAI budget gate refuses an unlisted
  // model BEFORE any fetch, so dispatch can never serve it; the fingerprint
  // must omit it the same way, not advertise it first with a null rate.
  describe("omits OpenAI entries the budget gate statically refuses (#5047 round 2 F1)", () => {
    it("an unlisted OPENAI_MODEL drops OpenAI from the notebook cascade; the priced fallback stays", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENAI_MODEL = "gpt-99-unlisted";
      process.env.OPENROUTER_API_KEY = "or-test-not-a-real-key";
      const { summary } = inferenceFingerprint();
      expect(summary.providers.map((p) => p.name)).toEqual(["OpenRouter"]);
    });

    it("a listed OPENAI_MODEL keeps OpenAI first (control)", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENAI_MODEL = "gpt-5.4-nano";
      process.env.OPENROUTER_API_KEY = "or-test-not-a-real-key";
      const { summary } = inferenceFingerprint();
      expect(summary.providers.map((p) => p.name)).toEqual(["OpenAI", "OpenRouter"]);
      expect(summary.providers[0].pricePerMtok).toEqual({ input: 0.2, cached_input: 0.02, output: 1.25 });
    });

    it("a price override never makes an unlisted model dispatchable (same rule as the cap)", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENAI_MODEL = "gpt-99-unlisted";
      process.env.OPENAI_PRICE_PER_MTOK_IN = "1";
      process.env.OPENAI_PRICE_PER_MTOK_OUT = "2";
      expect(inferenceFingerprint().summary.providers).toEqual([]);
    });

    it("an unlisted OPENAI_CLASSIFIER_MODEL drops OpenAI from the query-rewrite lane too", () => {
      process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
      process.env.OPENROUTER_API_KEY = "or-test-not-a-real-key";
      process.env.NOTEBOOK_QUERY_REWRITE = "1";
      process.env.OPENAI_CLASSIFIER_MODEL = "gpt-99-unlisted";
      const lane = inferenceFingerprint().summary.optionalMetered.queryRewrite;
      expect(lane.enabled && lane.providers.map((p) => p.name)).toEqual(["OpenRouter"]);
    });

    it("a non-OpenAI provider with no declared rate is still listed, at a null rate (dispatch does not gate it)", () => {
      process.env.MIRA_CANONICAL_SEAM = "0";
      process.env.GEMINI_API_KEY = "gm-test-not-a-real-key";
      expect(inferenceFingerprint().summary.providers).toEqual([
        { name: "Gemini", model: "gemini-2.5-flash", pricePerMtok: null },
      ]);
    });
  });
});

// #5050: the post-answer safety judge is a paid call the route makes on every
// gated turn. It dispatches from canonicalProviders() whatever the seam says,
// so with the seam OFF its providers differ from the answer's — the walk must
// see them to book and price the judge.
describe("safety judge lane (#5050)", () => {
  it("is reported disabled only when the kill switch is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    expect(inferenceFingerprint().summary.optionalMetered.safetyJudge).toEqual({ enabled: false });
  });

  it("reports the judge cap and its keyed canonical providers when on", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    const lane = inferenceFingerprint().summary.optionalMetered.safetyJudge;
    expect(lane).toEqual({
      enabled: true,
      maxOutputTokens: 200,
      providers: [{ name: "OpenAI", model: "gpt-5.4-mini", pricePerMtok: expect.any(Object) }],
    });
  });

  it("seam off: the judge still lists OpenAI although the answer cascade does not", () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.GROQ_API_KEY = "gsk-test-not-a-real-key";
    const { summary } = inferenceFingerprint();
    expect(summary.providers.map((p) => p.name)).toEqual(["Groq"]);
    const judge = summary.optionalMetered.safetyJudge;
    expect(judge.enabled && judge.providers.map((p) => p.name)).toEqual(["OpenAI", "Groq"]);
  });

  it("switching the judge off changes the hash", () => {
    const on = inferenceFingerprint().hash;
    process.env.NOTEBOOK_SEMANTIC_CHECK = "0";
    expect(inferenceFingerprint().hash).not.toBe(on);
  });
});

// #5051: maxOutputTokens is the per-turn ceiling, not what the answer call
// requests. The route asks for min(1400, cap) with the seam on and a flat 1400
// (coverage directive) with it off, so the walk books against this value.
describe("notebook answer output cap (#5051)", () => {
  it("seam on: min(1400, MIRA_TURN_MAX_OUTPUT_TOKENS)", () => {
    expect(inferenceFingerprint().summary.notebookMaxOutputTokens).toBe(1400);
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "600";
    expect(inferenceFingerprint().summary.notebookMaxOutputTokens).toBe(600);
  });

  it("seam off: 1400 regardless of the turn cap", () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    process.env.MIRA_TURN_MAX_OUTPUT_TOKENS = "600";
    expect(inferenceFingerprint().summary.notebookMaxOutputTokens).toBe(1400);
  });

  it("matches the literals the chat route requests (source pin)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const route = readFileSync(join(__dirname, "../../../app/api/equipment-notebooks/[id]/chat/route.ts"), "utf8");
    const m = route.match(
      /const requestCap = seam \? Math\.min\(coverageDirective \? (\d+) : (\d+), outputCap\) : coverageDirective \? (\d+) : (\d+);/,
    );
    expect(m, "route requestCap expression moved or changed").not.toBeNull();
    const [, seamHi, , offHi] = m!.map(Number) as number[];
    expect(seamHi).toBe(1400);
    expect(offHi).toBe(1400);
    const { NOTEBOOK_ANSWER_MAX_OUTPUT_TOKENS } = await import("../runtime-identity");
    expect(NOTEBOOK_ANSWER_MAX_OUTPUT_TOKENS).toBe(Math.max(...m!.slice(1).map(Number)));
  });
});
