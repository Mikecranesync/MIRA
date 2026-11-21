// #5265 — MIRA_PROFILE=edge startup guard: refuse to start while any cloud
// credential is set, or while an outbound endpoint resolves off the device —
// checked by EFFECTIVE value, so a built-in cloud default counts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertEdgeStartupGuard, edgeProfileEnabled } from "../edge-profile";
import { effectiveNotebookProviders } from "../legacy-cascade";

const CREDENTIALS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHERAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "JEV_API_KEY",
  "EXA_API_KEY",
  "RESEND_API_KEY",
  "PLG_POSTHOG_KEY",
  "SLACK_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "FACTORYLMDIAGNOSE_TELEGRAM_BOT_TOKEN",
  "HUBSPOT_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "HUB_AUTH_GOOGLE_CLIENT_SECRET",
];
// Off when unset or "".
const OPTIONAL_ENDPOINTS = [
  "NEON_DATABASE_URL",
  "OLLAMA_BASE_URL",
  "INGEST_URL",
  "RERANKER_URL",
  "PIPELINE_URL",
  "OPENWEBUI_BASE_URL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
];
// The code falls back to a cloud/service address when unset.
const DEFAULTED_ENDPOINTS = ["MIRA_ASK_URL", "HUB_CMMS_API_URL", "NANGO_SERVER_URL", "OTA_ORIGIN"];
const ALL = [...CREDENTIALS, ...OPTIONAL_ENDPOINTS, ...DEFAULTED_ENDPOINTS, "MIRA_PROFILE", "MIRA_CANONICAL_SEAM"];
const saved = { ...process.env };

/** A device env that passes: every defaulted endpoint pointed at loopback or turned off. */
function sealedDevice(): void {
  process.env.MIRA_PROFILE = "edge";
  process.env.MIRA_ASK_URL = "";
  process.env.HUB_CMMS_API_URL = "";
  process.env.NANGO_SERVER_URL = "";
  process.env.OTA_ORIGIN = "http://127.0.0.1:1";
}

beforeEach(() => {
  process.env = { ...saved };
  for (const k of ALL) delete process.env[k];
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

describe("assertEdgeStartupGuard", () => {
  it("does nothing when the profile is off", () => {
    process.env.GROQ_API_KEY = "gsk-a";
    process.env.INGEST_URL = "https://app.factorylm.com/ingest";
    expect(() => assertEdgeStartupGuard()).not.toThrow();
  });

  it("passes on a sealed device, and no answer provider is dispatchable there", () => {
    sealedDevice();
    expect(() => assertEdgeStartupGuard()).not.toThrow();
    expect(effectiveNotebookProviders().filter((p) => p.key)).toEqual([]);
  });

  it.each(CREDENTIALS)("refuses while %s is set", (key) => {
    sealedDevice();
    process.env[key] = "secret-value";
    expect(() => assertEdgeStartupGuard()).toThrow(key);
  });

  it("ignores a credential that is set but empty", () => {
    sealedDevice();
    process.env.GROQ_API_KEY = "";
    expect(() => assertEdgeStartupGuard()).not.toThrow();
  });

  it.each(DEFAULTED_ENDPOINTS)("refuses while %s is unset (its default leaves the device)", (name) => {
    sealedDevice();
    delete process.env[name];
    expect(() => assertEdgeStartupGuard()).toThrow(name);
  });

  it("refuses OTA_ORIGIN set to \"\" (the code still falls back to the release host)", () => {
    sealedDevice();
    process.env.OTA_ORIGIN = "";
    expect(() => assertEdgeStartupGuard()).toThrow("OTA_ORIGIN");
  });

  it.each([...OPTIONAL_ENDPOINTS, ...DEFAULTED_ENDPOINTS])("refuses %s pointed off the device", (name) => {
    sealedDevice();
    process.env[name] = "http://192.168.4.103:8080/x";
    expect(() => assertEdgeStartupGuard()).toThrow(name);
  });

  it.each(["http://127.0.0.1:5433/x", "http://localhost:9000", "http://[::1]:8080"])("accepts loopback %s", (url) => {
    sealedDevice();
    process.env.INGEST_URL = url;
    process.env.MIRA_ASK_URL = url;
    expect(() => assertEdgeStartupGuard()).not.toThrow();
  });

  it("refuses an endpoint it cannot parse", () => {
    sealedDevice();
    process.env.RERANKER_URL = "not a url";
    expect(() => assertEdgeStartupGuard()).toThrow("RERANKER_URL");
  });

  it("never echoes a credential's value or an endpoint's host", () => {
    sealedDevice();
    process.env.OPENAI_API_KEY = "sk-do-not-print";
    expect(() => assertEdgeStartupGuard()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("sk-do-not-print") }));
    delete process.env.OPENAI_API_KEY;
    process.env.INGEST_URL = "https://secret-host.example/ingest";
    expect(() => assertEdgeStartupGuard()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secret-host") }));
  });
});
