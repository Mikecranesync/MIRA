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

function baseline() {
  process.env = { ...saved };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_PRICE_PER_MTOK_IN;
  delete process.env.OPENAI_PRICE_PER_MTOK_OUT;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROQ_MODEL;
  delete process.env.MIRA_TURN_MAX_OUTPUT_TOKENS;
  delete process.env.MIRA_CANONICAL_SEAM;
  delete process.env.MIRA_JEV_SHADOW;
  delete process.env.MIRA_JEV_DECISION;
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
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.OPENAI_MODEL = "gpt-5.4-mini";
    process.env.OPENROUTER_API_KEY = "or-test-not-a-real-key";
    const { summary } = inferenceFingerprint();
    expect(summary.providers[0]).toEqual({
      name: "OpenAI",
      model: "gpt-5.4-mini",
      pricePerMtok: { input: 0.75, cached_input: 0.075, output: 4.5 },
    });
    expect(summary.providers.map((p) => p.name)).toEqual([
      "OpenAI",
      "OpenRouter",
      "Groq",
      "Cerebras",
      "Together",
    ]);
    expect(summary.maxOutputTokens).toBe(4000);
    expect(summary.canonicalSeam).toBe(false);
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
    process.env.MIRA_CANONICAL_SEAM = "1";
    const seam = inferenceFingerprint();
    expect(seam.hash).not.toBe(base);
    expect(seam.summary.canonicalSeam).toBe(true);
    delete process.env.MIRA_CANONICAL_SEAM;
    process.env.MIRA_JEV_SHADOW = "1";
    const jev = inferenceFingerprint();
    expect(jev.hash).not.toBe(base);
    expect(jev.summary.optionalMetered).toEqual({ jevShadow: true, jevDecision: false });
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

  it("reports an unpriced model as null rate, never 0 and never another model's rate", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    process.env.OPENAI_MODEL = "gpt-99-unlisted";
    const { summary } = inferenceFingerprint();
    expect(summary.providers[0].model).toBe("gpt-99-unlisted");
    expect(summary.providers[0].pricePerMtok).toBeNull();
  });
});
