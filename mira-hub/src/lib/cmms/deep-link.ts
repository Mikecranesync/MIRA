import { getProvider } from "./registry";
import { getTenantCMMSConfig, type TenantCMMSConfig } from "./tenant-config";
import type { CMMSEntityType } from "./provider";

/**
 * Result of resolveDeepLink — distinguishes the three render states the
 * OpenInCMMSButton needs to handle:
 *   - linked     : tenant has CMMS + entity has external id → show "Open in {name}"
 *   - unconfigured: tenant has no CMMS config              → show "Connect a CMMS →"
 *   - unlinked   : tenant has CMMS but entity has no external id → button hidden
 */
export type DeepLinkResolution =
  | { state: "linked"; url: string; providerName: string; provider: string }
  | { state: "unconfigured" }
  | { state: "unlinked"; providerName: string; provider: string };

export interface ResolveDeepLinkInput {
  tenantId: string;
  entityType: CMMSEntityType;
  /** External CMMS id on the entity, e.g. atlas_id. Null/undefined = entity not synced yet. */
  externalId: string | null | undefined;
}

/**
 * Resolve a deep link for an entity from the tenant's configured CMMS.
 * Pure read — does not write anything. Used by both the API route and
 * server components that want to render the link inline.
 */
export async function resolveDeepLink(
  input: ResolveDeepLinkInput,
): Promise<DeepLinkResolution> {
  const config = await getTenantCMMSConfig(input.tenantId);
  if (!config) return { state: "unconfigured" };

  // "home" is a special pseudo-entity that doesn't need an externalId — every
  // other entity type requires one (returns "unlinked" so the UI can hide).
  if (input.entityType !== "home" && !input.externalId) {
    return { state: "unlinked", providerName: config.displayName, provider: config.provider };
  }

  const provider = getProvider(config.provider);
  if (!provider) {
    // Tenant has a config row but the provider isn't registered (e.g. removed
    // a connector). Treat as unconfigured so the UI nudges them to reconnect.
    return { state: "unconfigured" };
  }

  const url = provider.deepLink(input.entityType, input.externalId ?? "", {
    baseUrl: config.baseUrl,
    displayName: config.displayName,
    options: config.options,
  });

  if (!url) {
    return { state: "unlinked", providerName: config.displayName, provider: config.provider };
  }

  return { state: "linked", url, providerName: config.displayName, provider: config.provider };
}

/** Re-exported for callers that already have a config in hand. */
export type { TenantCMMSConfig };
