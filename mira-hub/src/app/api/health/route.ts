import { NextResponse } from "next/server";

import {
  environmentName,
  captureContentEnabled,
  telemetryEnabled,
} from "@/capabilities/observability/config";

export const dynamic = "force-dynamic";

/**
 * Liveness + env-sanity probe. Returns 503 if a secret the hub depends on
 * is missing, which flips the container's Docker healthcheck to "unhealthy"
 * so a deploy that forgot to inject secrets (e.g. missing `doppler run --`)
 * fails loud in `docker ps` instead of silently serving 503s from every
 * other API route.
 */
export function GET() {
  // Deploy identity (#2226) — baked at build time, surfaced here so the same
  // probe that reports liveness also says WHICH code is live. See /api/version.
  const identity = {
    version: process.env.MIRA_APP_VERSION || "unknown",
    gitSha: process.env.MIRA_GIT_SHA || "unknown",
    builtAt: process.env.MIRA_BUILD_TIME || "unknown",
  };

  // Effective retrieval-approval gate (Workstream B, PRD §8.2). Non-secret:
  // it is the boolean `manual-rag.ts` reads, surfaced so the beta gate and the
  // production probe can ASSERT they run against the production gate instead
  // of inferring it from a compose default (#3328 is what that costs).
  const approvedRetrievalEnforced = process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL === "true";

  // Effective contract flag — whether MIRA Intelligence Contract is active.
  // Surfaced so the beta probe can adjust expectations for empty-notebook behavior.
  const miraContractEnabled = process.env.MIRA_PERSONA_CONTRACT === "1";

  const required = ["NEON_DATABASE_URL", "INGEST_URL"] as const;
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return NextResponse.json(
      { status: "unhealthy", service: "mira-hub", missing, ...identity, ts: Date.now() },
      { status: 503 },
    );
  }

  // Turn Flight Recorder (docs/architecture/observability/2026-09-22-turn-flight-recorder.md §6).
  // Never the endpoint or headers — those may carry a Doppler-managed auth value.
  const telemetry = {
    tracing: telemetryEnabled() ? ("enabled" as const) : ("disabled" as const),
    exporter: telemetryEnabled() ? ("otlp-http" as const) : null,
    environment: environmentName(),
    contentCapture: captureContentEnabled(),
  };

  return NextResponse.json({
    status: "ok",
    service: "mira-hub",
    ...identity,
    approvedRetrievalEnforced,
    miraContractEnabled,
    telemetry,
    ts: Date.now(),
  });
}
