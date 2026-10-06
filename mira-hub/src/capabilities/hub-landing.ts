/**
 * Where a signed-in technician lands.
 *
 * Staging runs the FactoryLM shell (`/v3`) as its only front door (owner
 * decision, 2026-10-05): the root and the classic home (`/feed`) both go to
 * the shell, so login, signup and magic links — which all push to `/feed` —
 * land there too. Every other environment keeps the classic `/feed` landing
 * until the cutover gate passes (docs/architecture/convergence/UNIFIED_UI_CUTOVER.md §8).
 *
 * The environment comes from `deployment.environment.name` in
 * OTEL_RESOURCE_ATTRIBUTES, which staging already sets and production does not,
 * so production cannot flip by accident: anything other than exactly "staging"
 * keeps today's behaviour. Pure and edge-safe — the middleware imports it.
 */
import { environmentName } from "@/capabilities/observability/config";

export const CLASSIC_LANDING = "/feed";
export const SHELL_LANDING = "/v3";

function isClassicHome(pathname: string): boolean {
  return pathname === "/feed" || pathname === "/feed/";
}

/**
 * The redirect target for an authenticated page request, or null to let it
 * through. Outside staging this is exactly the old rule: "/" → "/feed".
 */
export function landingRedirect(pathname: string, environment: string = environmentName()): string | null {
  const shell = environment === "staging";
  if (pathname === "/") return shell ? SHELL_LANDING : CLASSIC_LANDING;
  if (shell && isClassicHome(pathname)) return SHELL_LANDING;
  return null;
}
