import { NextResponse } from "next/server";

import {
  environmentName,
  captureContentEnabled,
  telemetryEnabled,
} from "@/capabilities/observability/config";
import { ensureEmbedRetrySweep } from "@/capabilities/embed-retry-sweep";
import { warmQueryEmbedder } from "@/capabilities/hybrid-retrieval";
import { deploymentGeneration, inferenceFingerprint } from "@/lib/inference/runtime-identity";

export const dynamic = "force-dynamic";

/**
 * Liveness + env-sanity probe. Returns 503 if a secret the hub depends on
 * is missing, which flips the container's Docker healthcheck to "unhealthy"
 * so a deploy that forgot to inject secrets (e.g. missing `doppler run --`)
 * fails loud in `docker ps` instead of silently serving 503s from every
 * other API route.
 */
export function GET() {
  // Docker's healthcheck polls this every 30 s from boot, so it is the one call
  // guaranteed to reach a fresh container: it starts the embed retry sweep
  // (idempotent, never blocks or throws — see capabilities/embed-retry-sweep.ts).
  ensureEmbedRetrySweep();
  // Same reason it warms the notebook query embedder (once per process, and only
  // when NOTEBOOK_HYBRID_RETRIEVAL=1): the first turn after a deploy otherwise
  // pays the cold model load and silently falls back to BM25.
  void warmQueryEmbedder().catch(() => undefined);
  // Deploy identity (#2226) — baked at build time, surfaced here so the same
  // probe that reports liveness also says WHICH code is live. See /api/version.
  const identity = {
    version: process.env.MIRA_APP_VERSION || "unknown",
    gitSha: process.env.MIRA_GIT_SHA || "unknown",
    builtAt: process.env.MIRA_BUILD_TIME || "unknown",
    // Runtime identity (#4507): WHICH process (changes on every recreate, even
    // from the same image) and WHAT it bills with (the effective cascade), so
    // the Stranger Walk can detect a same-image redeploy and price its budget
    // from the running Hub instead of its own Doppler snapshot. Non-secret.
    deploymentGeneration: deploymentGeneration(),
    inferenceFingerprint: inferenceFingerprint(),
  };

  // Effective retrieval-approval gate (Workstream B, PRD §8.2). Non-secret:
  // it is the boolean `manual-rag.ts` reads, surfaced so the beta gate and the
  // production probe can ASSERT they run against the production gate instead
  // of inferring it from a compose default (#3328 is what that costs).
  const approvedRetrievalEnforced = process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL === "true";

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
    telemetry,
    ts: Date.now(),
  });
}
