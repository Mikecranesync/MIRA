/**
 * #5265 — the EDGE profile (`MIRA_PROFILE=edge`): the same Hub on one device.
 * Notebook answers are the retrieved manual passages, verbatim, with no answer
 * model (capabilities/edge-passages.ts). This module is the startup guard: the
 * process refuses to start while a LISTED cloud credential is set, or while a
 * LISTED endpoint variable's effective URL names a non-loopback host.
 *
 * It checks configuration only. It does not cover destinations that arrive per
 * request or from stored data: the OpenWebUI and Telegram connect routes, the
 * Dropbox/Google external-download upload path, stored Google bindings, and
 * Command Center gateway probes. It does no DNS resolution or redirect
 * checking. Closing those (#5265, W1) and the network-blocked run with a
 * traffic monitor (plan W5) are what show nothing leaves the device.
 *
 * Field evidence: factorylm PR #237, docs/air-force-rfi/w0-tablet-spike.md
 * (Galaxy Tab S9 FE, 2026-11-07).
 */

/** Cloud credentials a Hub lane reads (AI providers, evidence judge, web search, email, analytics, chat, CRM lead capture, Google sign-in). Non-empty = refuse. */
const CLOUD_CREDENTIALS = [
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
] as const;

/**
 * Outbound endpoints a Hub lane may call, with the address the code falls back
 * to. The EFFECTIVE value is checked, so a cloud default counts.
 *  - `fallback: null` — unset or "" turns the lane off.
 *  - `emptyUsesFallback` — the code reads it with `||`, so "" still means the
 *    default; only a loopback address passes.
 */
const OUTBOUND_ENDPOINTS: Record<string, { fallback: string | null; emptyUsesFallback?: boolean }> = {
  NEON_DATABASE_URL: { fallback: null },
  OLLAMA_BASE_URL: { fallback: null },
  INGEST_URL: { fallback: null },
  RERANKER_URL: { fallback: null },
  PIPELINE_URL: { fallback: null },
  OPENWEBUI_BASE_URL: { fallback: null },
  OTEL_EXPORTER_OTLP_ENDPOINT: { fallback: null },
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: { fallback: null },
  MIRA_ASK_URL: { fallback: "http://mira-ask:8011" },
  HUB_CMMS_API_URL: { fallback: "https://cmms.factorylm.com" },
  NANGO_SERVER_URL: { fallback: "http://nango-server:3003" },
  OTA_ORIGIN: { fallback: "https://updates.factorylm.com", emptyUsesFallback: true },
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function edgeProfileEnabled(): boolean {
  return process.env.MIRA_PROFILE === "edge";
}

function effectiveValue(name: string): string | null {
  const { fallback, emptyUsesFallback } = OUTBOUND_ENDPOINTS[name];
  const raw = process.env[name];
  if (raw === undefined || (raw === "" && emptyUsesFallback)) return fallback;
  return raw;
}

function offDevice(value: string): boolean {
  try {
    return !LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return true; // unparseable: cannot show it stays on the device
  }
}

/**
 * Throws when the edge profile is on and a listed credential is set or a
 * listed endpoint's effective URL is not loopback. Names the variables, never their
 * values or hosts. A no-op when the profile is off.
 */
export function assertEdgeStartupGuard(): void {
  if (!edgeProfileEnabled()) return;
  const credentials = CLOUD_CREDENTIALS.filter((k) => Boolean(process.env[k]));
  if (credentials.length > 0) {
    throw new Error(`MIRA_PROFILE=edge refuses to start: cloud credential(s) set: ${credentials.join(", ")}`);
  }
  const endpoints = Object.keys(OUTBOUND_ENDPOINTS).filter((name) => {
    const value = effectiveValue(name);
    return Boolean(value) && offDevice(value as string);
  });
  if (endpoints.length > 0) {
    throw new Error(
      `MIRA_PROFILE=edge refuses to start: endpoint(s) not on this device (use a loopback address, or "" where the lane can be off): ${endpoints.join(", ")}`,
    );
  }
}
