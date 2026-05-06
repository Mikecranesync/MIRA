import { withTenantContext } from "@/lib/tenant-context";

/**
 * Per-tenant CMMS configuration loaded from the tenant_cmms_config table.
 * Returned by getTenantCMMSConfig() when the tenant has an enabled config.
 */
export interface TenantCMMSConfig {
  provider: string;
  baseUrl: string;
  displayName: string;
  options: Record<string, unknown>;
}

interface CacheEntry {
  config: TenantCMMSConfig | null;
  loadedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Fetch the active CMMS config for a tenant. Returns null if the tenant has
 * no enabled config (the UI then renders a "Connect a CMMS" fallback).
 *
 * Cached for 60 seconds per tenant — config changes are infrequent and the
 * deep-link path is hit on every WO/asset detail render.
 */
export async function getTenantCMMSConfig(tenantId: string): Promise<TenantCMMSConfig | null> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  if (!process.env.NEON_DATABASE_URL) {
    return null;
  }

  try {
    const row = await withTenantContext(tenantId, (c) =>
      c
        .query<{
          provider: string;
          base_url: string;
          display_name: string;
          config: Record<string, unknown> | null;
        }>(
          `SELECT provider, base_url, display_name, config
           FROM tenant_cmms_config
           WHERE tenant_id = $1::uuid AND enabled = TRUE
           LIMIT 1`,
          [tenantId],
        )
        .then((r) => r.rows[0] ?? null),
    );

    const config: TenantCMMSConfig | null = row
      ? {
          provider: row.provider,
          baseUrl: row.base_url,
          displayName: row.display_name,
          options: row.config ?? {},
        }
      : null;

    cache.set(tenantId, { config, loadedAt: Date.now() });
    return config;
  } catch (err) {
    console.error("[cmms/tenant-config] load failed", err);
    return null;
  }
}

/** Drop a tenant's cached config — call after writes to tenant_cmms_config. */
export function invalidateTenantCMMSConfig(tenantId: string): void {
  cache.delete(tenantId);
}
