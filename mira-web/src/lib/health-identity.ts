/**
 * Health endpoint identity contract.
 *
 * Reads environment variables (MIRA_GIT_SHA, MIRA_APP_VERSION, MIRA_BUILD_TIME)
 * and returns them, or "unknown" if not set.
 */

export interface HealthIdentity {
  status: "ok";
  service: "mira-web";
  gitSha: string;
  version: string;
  builtAt: string;
}

export function getHealthIdentity(): HealthIdentity {
  return {
    status: "ok",
    service: "mira-web",
    gitSha: process.env.MIRA_GIT_SHA || "unknown",
    version: process.env.MIRA_APP_VERSION || "unknown",
    builtAt: process.env.MIRA_BUILD_TIME || "unknown",
  };
}
