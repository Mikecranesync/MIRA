import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deploy-identity probe (#2226). Returns the version + git SHA + build time of
 * the running container so a QA pass (or an operator) can confirm WHICH code is
 * live without guessing. The values are baked at image-build time via Docker
 * build-args (see mira-hub/Dockerfile + docker-compose.saas.yml + deploy-vps.yml)
 * and read here from the runtime env. Unset ⇒ "unknown" (e.g. a local `next dev`
 * that never ran the Docker build) rather than a hard failure.
 *
 * No auth: it exposes only the public commit SHA + version string, nothing
 * tenant- or secret-scoped — the same identity a `git log` already shows.
 */
export function GET() {
  return NextResponse.json({
    service: "mira-hub",
    version: process.env.MIRA_APP_VERSION || "unknown",
    gitSha: process.env.MIRA_GIT_SHA || "unknown",
    builtAt: process.env.MIRA_BUILD_TIME || "unknown",
    ts: Date.now(),
  });
}
