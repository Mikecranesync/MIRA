import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { deploymentGeneration } from "@/lib/inference/runtime-identity";

export const dynamic = "force-dynamic";

/**
 * Deploy-identity probe (#2226). Returns the version + git SHA + build time of
 * the running container so a QA pass (or an operator) can confirm WHICH code is
 * live without guessing. The values are baked at image-build time via Docker
 * build-args (see mira-hub/Dockerfile + docker-compose.saas.yml + deploy-vps.yml)
 * and read here from the runtime env. Unset ⇒ "unknown" (e.g. a local `next dev`
 * that never ran the Docker build) rather than a hard failure.
 *
 * No auth: it exposes release identity plus a digest of an allowlisted,
 * non-secret feature switch. The generation and digest let Mission Control
 * recognize a same-image restart or a change to the equipment navigation flag.
 */
export function GET() {
  const nav = process.env.MIRA_EQUIPMENT_NAV;
  const configurationSha256 = createHash("sha256")
    .update(JSON.stringify({ equipmentNavigation: nav === "1" || nav === "true" }))
    .digest("hex");

  return NextResponse.json({
    service: "mira-hub",
    version: process.env.MIRA_APP_VERSION || "unknown",
    gitSha: process.env.MIRA_GIT_SHA || "unknown",
    builtAt: process.env.MIRA_BUILD_TIME || "unknown",
    runtimeGeneration: deploymentGeneration(),
    configurationSha256,
    ts: Date.now(),
  });
}
