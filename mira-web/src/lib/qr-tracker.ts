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
