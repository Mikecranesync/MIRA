// #5048 — the LEGACY inline notebook cascade moved out of the route file so the
// runtime identity can fingerprint it. It must stay byte-identical to the list
// the route carried (names, URLs, env-var names, model defaults, order), and
// `effectiveNotebookProviders()` must pick the list the route dispatches and
// drop the entries dispatch skips (no key).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { effectiveNotebookProviders, legacyProviders } from "../legacy-cascade";

const saved = { ...process.env };

beforeEach(() => {
  process.env = { ...saved };
  for (const k of [
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "CEREBRAS_API_KEY",
    "CEREBRAS_MODEL",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "TOGETHERAI_API_KEY",
    "MIRA_CANONICAL_SEAM",
  ]) {
    delete process.env[k];
  }
});
afterEach(() => {
  process.env = { ...saved };
});

describe("legacyProviders", () => {
  it("is the route's inline list, in order, with its defaults", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    process.env.CEREBRAS_API_KEY = "cb-a";
    process.env.GEMINI_API_KEY = "gm-a";
    expect(legacyProviders()).toEqual([
      { name: "Groq", url: "https://api.groq.com/openai/v1/chat/completions", key: "gsk-a", model: "openai/gpt-oss-120b" },
      { name: "Cerebras", url: "https://api.cerebras.ai/v1/chat/completions", key: "cb-a", model: "gpt-oss-120b" },
      {
        name: "Gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: "gm-a",
        model: "gemini-2.5-flash",
      },
    ]);
  });

  it("honours the same model env vars the route read", () => {
    process.env.GROQ_MODEL = "g-x";
    process.env.CEREBRAS_MODEL = "c-x";
    process.env.GEMINI_MODEL = "m-x";
    expect(legacyProviders().map((p) => p.model)).toEqual(["g-x", "c-x", "m-x"]);
  });

  it("keeps keyless entries (the route filters at dispatch, not here)", () => {
    expect(legacyProviders().map((p) => p.key)).toEqual([undefined, undefined, undefined]);
  });
});

describe("effectiveNotebookProviders", () => {
  it("seam off: the legacy list, keyless entries dropped", () => {
    process.env.MIRA_CANONICAL_SEAM = "0";
    process.env.GEMINI_API_KEY = "gm-a";
    process.env.OPENAI_API_KEY = "sk-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["Gemini"]);
  });

  it("seam on: the canonical list, keyless entries dropped", () => {
    process.env.MIRA_CANONICAL_SEAM = "1";
    process.env.OPENAI_API_KEY = "sk-a";
    process.env.GEMINI_API_KEY = "gm-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["OpenAI"]);
  });
});
