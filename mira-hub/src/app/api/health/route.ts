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
  const required = ["NEON_DATABASE_URL", "INGEST_URL"] as const;
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return NextResponse.json(
      { status: "unhealthy", service: "mira-hub", missing, ts: Date.now() },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", service: "mira-hub", ts: Date.now() });
}
