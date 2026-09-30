/**
 * The Hub origin this web surface hands users to (#3930 — co-hosted staging).
 *
 * Every link, redirect, CTA and default that used to spell out
 * https://app.factorylm.com goes through here so a STAGING web can never hand a
 * user to the PRODUCTION hub: staging sets PLG_HUB_URL=https://app-staging.factorylm.com;
 * production leaves it unset and keeps the historical default unchanged.
 *
 * Side-effect-free module (like deploy-identity.ts) so it is unit-testable
 * without importing server.ts.
 */
export const PRODUCTION_HUB_ORIGIN = "https://app.factorylm.com";

export function hubOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.PLG_HUB_URL ?? "").trim();
  return (raw || PRODUCTION_HUB_ORIGIN).replace(/\/+$/, "");
}

export function hubUrl(path: string, env?: Record<string, string | undefined>): string {
  return `${hubOrigin(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
