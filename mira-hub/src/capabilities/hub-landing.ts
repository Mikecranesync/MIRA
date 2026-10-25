/**
 * Where a signed-in technician lands.
 *
 * Every environment runs the FactoryLM shell (`/v3`) as its front door. Staging
 * has since the owner decision of 2026-10-05; production joined on the owner
 * directive of 2026-10-14 (#3880: "make them default to the new interface").
 * The root and the classic home (`/feed`) both go to the shell, so login,
 * signup and magic links, which all push to `/feed`, land there too. Every
 * other legacy page stays reachable by its own URL.
 *
 * Rollback is a redeploy of the previous release, not a flag: see #3880.
 * Pure and edge-safe — the middleware imports it.
 */
export const SHELL_LANDING = "/v3";

function isClassicHome(pathname: string): boolean {
  return pathname === "/feed" || pathname === "/feed/";
}

/** The redirect target for an authenticated page request, or null to let it through. */
export function landingRedirect(pathname: string): string | null {
  if (pathname === "/" || isClassicHome(pathname)) return SHELL_LANDING;
  return null;
}
