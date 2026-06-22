import { NextResponse } from "next/server";

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

  const required = ["NEON_DATABASE_URL", "INGEST_URL"] as const;
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return NextResponse.json(
      { status: "unhealthy", service: "mira-hub", missing, ...identity, ts: Date.now() },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", service: "mira-hub", ...identity, ts: Date.now() });
}
