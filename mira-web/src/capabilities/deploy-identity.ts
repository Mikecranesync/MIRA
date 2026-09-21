/**
 * Deploy identity for the marketing site (#3910 — exact-source deploy contract).
 *
 * MIRA_GIT_SHA / MIRA_APP_VERSION / MIRA_BUILD_TIME are baked in at image build
 * (mira-web/Dockerfile ARG -> ENV, fed by the compose build args that
 * deploy-vps.yml / deploy-staging.yml export from the approved RC SHA). The
 * deploy workflows assert `/api/health.gitSha == approved_rc_sha` after the
 * container swap, so this must report the environment and never a hardcoded
 * version. Unset => "unknown" (a local `bun run` never ran the Docker build).
 *
 * Kept as a side-effect-free module so it can be unit-tested without importing
 * server.ts (whose module-level setup perturbs the rest of the bun suite).
 */

export interface DeployIdentity {
  status: "ok";
  service: "mira-web";
  version: string;
  gitSha: string;
  builtAt: string;
}

export function deployIdentity(env: NodeJS.ProcessEnv = process.env): DeployIdentity {
  return {
    status: "ok",
    service: "mira-web",
    version: env.MIRA_APP_VERSION || "unknown",
    gitSha: env.MIRA_GIT_SHA || "unknown",
    builtAt: env.MIRA_BUILD_TIME || "unknown",
  };
}
