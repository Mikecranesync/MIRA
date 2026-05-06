import type { CMMSProvider, CMMSProviderConfig, CMMSEntityType } from "./provider";

/**
 * Atlas (cmms.factorylm.com) deep-link provider.
 *
 * Route map (matches the Atlas Next.js app):
 *   /workorders/:id  — work order detail
 *   /assets/:id      — asset / equipment detail
 *   /schedule/:id    — PM schedule detail
 *   home             — base URL only, no path
 */
const ROUTE: Record<CMMSEntityType, (id: string) => string> = {
  work_order:  (id) => `/workorders/${encodeURIComponent(id)}`,
  asset:       (id) => `/assets/${encodeURIComponent(id)}`,
  pm_schedule: (id) => `/schedule/${encodeURIComponent(id)}`,
  home:        ()   => "",
};

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export const atlasProvider: CMMSProvider = {
  id: "atlas",

  deepLink(entityType, externalId, config: CMMSProviderConfig): string | null {
    const route = ROUTE[entityType];
    if (!route) return null;
    // "home" doesn't need an externalId — every other entity type does.
    if (entityType !== "home" && !externalId) return null;
    const base = trimTrailingSlash(config.baseUrl);
    return `${base}${route(externalId ?? "")}`;
  },
};
