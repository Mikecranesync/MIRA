import { getProvider } from "./registry";
import { getTenantCMMSConfig } from "./tenant-config";
import type { DeepLinkKind } from "./provider";

// Three terminal states for an "Open in CMMS" surface.
export type DeepLinkResult =
  | { status: "ready"; url: string; provider: string; providerSlug: string }
  | { status: "syncing" }
  | { status: "unconfigured" };

/**
 * Resolve the deep-link for a given record.
 *
 * - `unconfigured` — tenant has no enabled config row → UI shows "Connect a CMMS →"
 * - `syncing`      — tenant configured but `externalId` is null (sync hasn't filled it) → disabled "Syncing to CMMS…"
 * - `ready`        — both present → live link
 */
export async function getCMMSDeepLink(
  tenantId: string,
  kind: DeepLinkKind,
  externalId: string | null,
): Promise<DeepLinkResult> {
  const config = await getTenantCMMSConfig(tenantId);
  if (!config) return { status: "unconfigured" };

  if (!externalId) return { status: "syncing" };

  const provider = getProvider(config.provider);
  const url = provider.buildDeepLink({
    kind,
    externalId,
    baseUrl: config.baseUrl,
    overrideTemplates: config.linkTemplates,
  });

  return {
    status: "ready",
    url,
    provider: provider.name,
    providerSlug: provider.slug,
  };
}
