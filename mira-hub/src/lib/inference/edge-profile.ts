/**
 * #5265 — the EDGE profile (`MIRA_PROFILE=edge`): the same Hub, sealed on one
 * device. The notebook chat answers from a single local OpenAI-compatible
 * server (llama.cpp `llama-server`, Ollama) on loopback instead of the cloud
 * cascade, and the process refuses to start while any cloud provider key is
 * present — a sealed tablet must not be one env var away from sending a
 * technician's question off the device.
 *
 * Field evidence for the defaults: factorylm PR #237,
 * docs/air-force-rfi/w0-tablet-spike.md (Galaxy Tab S9 FE, 2026-11-07).
 */
import type { CanonicalProvider } from "./canonical-cascade";

/** Every cloud provider key a Hub lane reads. Present + non-empty = not sealed. */
const CLOUD_PROVIDER_KEYS = [
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHERAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const DEFAULT_EDGE_LLM_URL = "http://127.0.0.1:8080/v1/chat/completions";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * On-device generation is slower than a hosted API: a 1.5B model on the
 * tablet's CPU reads ~60 tok/s, so a full retrieval prompt can take tens of
 * seconds. The cloud cascade's 30 s per-attempt timeout would cut it off.
 */
export const EDGE_ATTEMPT_TIMEOUT_MS = 180_000;

export function edgeProfileEnabled(): boolean {
  return process.env.MIRA_PROFILE === "edge";
}

function edgeLlmUrl(): string {
  return process.env.MIRA_EDGE_LLM_URL || DEFAULT_EDGE_LLM_URL;
}

/**
 * The single provider the notebook chat dispatches under the edge profile.
 * `key` is a placeholder: the dispatch loop skips keyless providers, and a
 * local server ignores the bearer header.
 */
export function edgeProviders(): CanonicalProvider[] {
  return [{ name: "Local", url: edgeLlmUrl(), key: "local", model: process.env.MIRA_EDGE_LLM_MODEL || "local" }];
}

/** Sampling pinned so the same question, corpus and model give a repeatable answer. */
export function edgeRequestOverrides(): { temperature: number; seed: number } {
  return { temperature: 0, seed: 0 };
}

/**
 * Throws when the edge profile is on but the process is not sealed: a cloud
 * provider key is set, or the local model URL is not loopback. Names the
 * offending variable, never its value. A no-op when the profile is off.
 */
export function assertEdgeSealed(): void {
  if (!edgeProfileEnabled()) return;
  const present = CLOUD_PROVIDER_KEYS.filter((k) => Boolean(process.env[k]));
  if (present.length > 0) {
    throw new Error(`MIRA_PROFILE=edge refuses to start: cloud provider key(s) set: ${present.join(", ")}`);
  }
  let host: string;
  try {
    host = new URL(edgeLlmUrl()).hostname;
  } catch {
    throw new Error("MIRA_PROFILE=edge refuses to start: MIRA_EDGE_LLM_URL is not a valid URL");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`MIRA_PROFILE=edge refuses to start: MIRA_EDGE_LLM_URL must be loopback, got host ${host}`);
  }
}
