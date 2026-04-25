/**
 * NeonDB access layer for the QR scan route.
 *
 * Three exports:
 *   - ASSET_TAG_RE       regex matching valid asset_tag strings
 *   - resolveAssetForScan(tenant, tag) -> { found, atlas_asset_id? }
 *   - recordScan({...}) -> scan_id (UUID)
 *
 * resolveAssetForScan is constant-time branch-wise: always issues the
 * same SELECT, only the result differs. Prevents the cross-tenant
 * enumeration oracle flagged in spec §12.6.
 *
 * Uses @neondatabase/serverless neon() HTTP transport — same pattern as
 * quota.ts, blog-db.ts, connect.ts. No Client lifecycle management needed.
 */
import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export const ASSET_TAG_RE = /^[A-Za-z0-9._-]{1,64}$/;

export type ResolveResult =
  | { found: true; atlas_asset_id: number }
  | { found: false };

export async function resolveAssetForScan(
  tenantId: string,
  assetTag: string,
): Promise<ResolveResult> {
  if (!ASSET_TAG_RE.test(assetTag)) return { found: false };

  const db = sql();
  const rows = await db`
    SELECT atlas_asset_id FROM asset_qr_tags
    WHERE tenant_id = ${tenantId}::uuid
      AND lower(asset_tag) = lower(${assetTag})
    LIMIT 1`;

  if (rows.length === 0) return { found: false };
  return { found: true, atlas_asset_id: rows[0].atlas_asset_id as number };
}

export interface ChannelConfig {
  tenantId: string;
  atlasAssetId: number;
  enabledChannels: string[];
  telegramBotUsername: string | null;
  openwebuiUrl: string;
  allowGuestReports: boolean;
}

export type ResolveWithChannelResult =
  | { found: false }
  | ({ found: true } & ChannelConfig);

/**
 * Global (cross-tenant) lookup for unauthed QR scans.
 * Returns the first tenant that owns this asset_tag + their channel config.
 * Used when no mira_session cookie is present — caller must preserve
 * byte-identical not-found HTML for cross-tenant privacy (spec §12.6).
 */
export async function resolveAssetWithChannelConfig(
  assetTag: string,
): Promise<ResolveWithChannelResult> {
  if (!ASSET_TAG_RE.test(assetTag)) return { found: false };

  const db = sql();
  const rows = await db`
    SELECT
      a.tenant_id,
      a.atlas_asset_id,
      COALESCE(c.enabled_channels, ARRAY['openwebui', 'guest']) AS enabled_channels,
      c.telegram_bot_username,
      COALESCE(c.openwebui_url, 'https://app.factorylm.com')   AS openwebui_url,
      COALESCE(c.allow_guest_reports, true)                     AS allow_guest_reports
    FROM asset_qr_tags a
    LEFT JOIN tenant_channel_config c ON c.tenant_id = a.tenant_id
    WHERE lower(a.asset_tag) = lower(${assetTag})
    LIMIT 1`;

  if (rows.length === 0) return { found: false };
  const r = rows[0];
  return {
    found: true,
    tenantId: r.tenant_id as string,
    atlasAssetId: r.atlas_asset_id as number,
    enabledChannels: r.enabled_channels as string[],
    telegramBotUsername: r.telegram_bot_username as string | null,
    openwebuiUrl: r.openwebui_url as string,
    allowGuestReports: r.allow_guest_reports as boolean,
  };
}

export interface RecordScanInput {
  tenant_id: string;
  asset_tag: string;
  atlas_user_id: number | null;
  user_agent: string | null;
  found: boolean;
}

export async function recordScan(input: RecordScanInput): Promise<string> {
  const db = sql();

  if (input.found) {
    await db`
      INSERT INTO asset_qr_tags
        (tenant_id, asset_tag, atlas_asset_id, first_scan, last_scan, scan_count)
      VALUES
        (${input.tenant_id}::uuid, ${input.asset_tag}, 0, NOW(), NOW(), 1)
      ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
        last_scan   = NOW(),
        scan_count  = asset_qr_tags.scan_count + 1,
        first_scan  = COALESCE(asset_qr_tags.first_scan, NOW())`;
  }

  const rows = await db`
    INSERT INTO qr_scan_events
      (tenant_id, asset_tag, atlas_user_id, user_agent)
    VALUES
      (${input.tenant_id}::uuid, ${input.asset_tag}, ${input.atlas_user_id}, ${input.user_agent})
    RETURNING scan_id`;

  return rows[0].scan_id as string;
}

// ---------------------------------------------------------------------------
// Asset context cache — written by QR handler, read by Python /start handler
// ---------------------------------------------------------------------------

export interface AssetContextPayload {
  asset_name: string;
  asset_model: string;
  asset_area: string;
  atlas_asset_id: number;
  work_orders: Array<{
    id: number;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    completedAt: string | null;
    description: string;
  }>;
  pre_loaded_at: string;
}

/**
 * Upsert the pre-loaded asset context into asset_context_cache.
 *
 * Keyed by (tenant_id, asset_tag) — this table bridges the TS QR handler
 * (which knows tenant + asset but not chat_id) to the Python /start handler
 * (which knows chat_id once the user taps the Telegram deep link).
 *
 * Never throws — returns false on failure so the QR redirect still completes.
 */
export async function upsertAssetContextCache(
  tenantId: string,
  assetTag: string,
  atlasAssetId: number,
  payload: AssetContextPayload,
): Promise<boolean> {
  try {
    const db = sql();
    const payloadJson = JSON.stringify(payload);
    await db`
      INSERT INTO asset_context_cache
        (tenant_id, asset_tag, atlas_asset_id, context_json, pre_loaded_at)
      VALUES
        (${tenantId}::uuid, ${assetTag}, ${atlasAssetId}, ${payloadJson}::jsonb, NOW())
      ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
        atlas_asset_id = EXCLUDED.atlas_asset_id,
        context_json   = EXCLUDED.context_json,
        pre_loaded_at  = NOW()`;
    return true;
  } catch {
    return false;
  }
}
