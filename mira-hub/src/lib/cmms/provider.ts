/**
 * CMMS provider abstraction.
 *
 * A CMMSProvider knows how to translate canonical entity references (work_order
 * by atlas_id, asset by atlas_id, ...) into provider-specific deep links.
 * Phase 1 ships the Atlas provider; MaintainX/Fiix/Limble plug in by
 * implementing this interface and registering themselves in registry.ts.
 *
 * Implementations must be pure: no DB calls, no fetches, no side effects.
 * Tenant-specific config (base_url, display_name) is passed in by the caller.
 */

/**
 * "home" is a pseudo-entity that resolves to the CMMS base URL — useful for
 * "Open in Atlas" CTAs on the /cmms hub page or in marketing surfaces.
 */
export type CMMSEntityType = "work_order" | "asset" | "pm_schedule" | "home";

export interface CMMSProviderConfig {
  /** Per-tenant base URL, e.g. "https://cmms.factorylm.com" or a self-hosted host. */
  baseUrl: string;
  /** Human-readable label shown on the button: "Atlas", "MaintainX". */
  displayName: string;
  /** Free-form provider-specific knobs from tenant_cmms_config.config. */
  options?: Record<string, unknown>;
}

export interface CMMSProvider {
  /** Stable identifier matching tenant_cmms_config.provider ('atlas', 'maintainx', ...). */
  readonly id: string;

  /**
   * Build a deep link to the entity inside this CMMS.
   * Returns null if the provider can't represent this entity type.
   */
  deepLink(
    entityType: CMMSEntityType,
    externalId: string,
    config: CMMSProviderConfig,
  ): string | null;
}
