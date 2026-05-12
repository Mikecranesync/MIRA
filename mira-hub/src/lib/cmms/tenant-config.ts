import { withTenantContext } from "@/lib/tenant-context";
import type { LinkTemplates } from "./provider";

// Per-tenant CMMS config row from `tenant_cmms_config` (migration 008).
export interface TenantCMMSConfig {
  tenantId: string;
  provider: string;
  baseUrl: string;
  linkTemplates: LinkTemplates;
  enabled: boolean;
}

interface ConfigRow {
  tenant_id: string;
  provider: string;
  base_url: string;
  link_templates: unknown;
  enabled: boolean;
}

/**
 * Fetch the tenant's CMMS config. Returns `null` when no row exists or the
 * row is disabled — UI should render the "Connect a CMMS →" CTA in that case.
 *
 * Reads under `withTenantContext`, so RLS on `tenant_cmms_config` is enforced
 * (a tenant can never read another's config).
 */
export async function getTenantCMMSConfig(
  tenantId: string,
): Promise<TenantCMMSConfig | null> {
  if (!process.env.NEON_DATABASE_URL) return null;

  try {
    return await withTenantContext<TenantCMMSConfig | null>(
      tenantId,
      async (c) => {
        const result = await c.query<ConfigRow>(
          `SELECT tenant_id, provider, base_url, link_templates, enabled
           FROM tenant_cmms_config
           WHERE tenant_id = $1
           LIMIT 1`,
          [tenantId],
        );
        const row = result.rows[0];
        if (!row || !row.enabled) return null;

        const templates =
          row.link_templates && typeof row.link_templates === "object"
            ? (row.link_templates as LinkTemplates)
            : {};

        return {
          tenantId: row.tenant_id,
          provider: row.provider,
          baseUrl: row.base_url,
          linkTemplates: templates,
          enabled: row.enabled,
        };
      },
    );
  } catch (err) {
    // If the table is missing (migration 008 not yet applied) or any other
    // DB error fires, degrade gracefully: caller treats null as unconfigured.
    const msg = String(err);
    if (msg.includes("tenant_cmms_config") && msg.includes("does not exist")) {
      return null;
    }
    console.error("[cmms/tenant-config]", err);
    return null;
  }
}
