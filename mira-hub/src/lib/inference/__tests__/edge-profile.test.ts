// #5265 — MIRA_PROFILE=edge: the notebook chat answers from ONE local,
// loopback-only provider, and the profile refuses to start while any cloud
// provider key is present (a sealed device must not be one env var away
// from sending a technician's question off the tablet).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertEdgeSealed, edgeProfileEnabled, edgeProviders, edgeRequestOverrides } from "../edge-profile";
import { effectiveNotebookProviders } from "../legacy-cascade";

const CLOUD_KEYS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHERAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "JEV_API_KEY",
  "EXA_API_KEY",
];
const saved = { ...process.env };

beforeEach(() => {
  process.env = { ...saved };
  for (const k of [...CLOUD_KEYS, "MIRA_PROFILE", "MIRA_EDGE_LLM_URL", "MIRA_EDGE_LLM_MODEL", "MIRA_CANONICAL_SEAM"]) {
    delete process.env[k];
  }
});
afterEach(() => {
  process.env = { ...saved };
});

describe("edgeProfileEnabled", () => {
  it("is on only for MIRA_PROFILE=edge", () => {
    expect(edgeProfileEnabled()).toBe(false);
    process.env.MIRA_PROFILE = "cloud";
    expect(edgeProfileEnabled()).toBe(false);
    process.env.MIRA_PROFILE = "edge";
    expect(edgeProfileEnabled()).toBe(true);
  });
});

describe("edgeProviders", () => {
  it("is one local provider with a non-empty key so dispatch does not skip it", () => {
    expect(edgeProviders()).toEqual([
      { name: "Local", url: "http://127.0.0.1:8080/v1/chat/completions", key: "local", model: "local" },
    ]);
  });

  it("honours MIRA_EDGE_LLM_URL and MIRA_EDGE_LLM_MODEL", () => {
    process.env.MIRA_EDGE_LLM_URL = "http://localhost:9000/v1/chat/completions";
    process.env.MIRA_EDGE_LLM_MODEL = "qwen2.5-1.5b-instruct-q4_0";
    expect(edgeProviders()[0]).toMatchObject({
      url: "http://localhost:9000/v1/chat/completions",
      model: "qwen2.5-1.5b-instruct-q4_0",
    });
  });
});

describe("effectiveNotebookProviders under the edge profile", () => {
  it("reports the local provider, never a cloud one, even when cloud keys exist", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.GROQ_API_KEY = "gsk-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["Local"]);
  });

  it("is unchanged when the profile is off", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    expect(effectiveNotebookProviders().map((p) => p.name)).toEqual(["Groq"]);
  });
});

describe("edgeRequestOverrides", () => {
  it("pins sampling so a repeated question gets a repeatable answer", () => {
    expect(edgeRequestOverrides()).toEqual({ temperature: 0, seed: 0 });
  });
});

describe("assertEdgeSealed", () => {
  it("does nothing when the profile is off", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it("passes with the profile on, no cloud keys and a loopback URL", () => {
    process.env.MIRA_PROFILE = "edge";
    expect(() => assertEdgeSealed()).not.toThrow();
    process.env.MIRA_EDGE_LLM_URL = "http://localhost:8080/v1/chat/completions";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it.each(CLOUD_KEYS)("refuses while %s is set", (key) => {
    process.env.MIRA_PROFILE = "edge";
    process.env[key] = "secret-value";
    expect(() => assertEdgeSealed()).toThrow(key);
  });

  it("ignores a cloud key that is set but empty", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.GROQ_API_KEY = "";
    expect(() => assertEdgeSealed()).not.toThrow();
  });

  it("refuses a local model URL that leaves the device", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.MIRA_EDGE_LLM_URL = "http://192.168.4.103:8080/v1/chat/completions";
    expect(() => assertEdgeSealed()).toThrow("MIRA_EDGE_LLM_URL");
  });

  it("never echoes a key's value in the refusal", () => {
    process.env.MIRA_PROFILE = "edge";
    process.env.OPENAI_API_KEY = "sk-do-not-print";
    expect(() => assertEdgeSealed()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("sk-do-not-print") }));
  });
});

