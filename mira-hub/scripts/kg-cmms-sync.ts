#!/usr/bin/env bun
/**
 * Standalone CMMS → KG sync script (#792).
 *
 * Usage:
 *   bun run scripts/kg-cmms-sync.ts --tenant-id <uuid>
 *
 * Env vars required:
 *   NEON_DATABASE_URL    — NeonDB connection string
 *   HUB_CMMS_API_URL    — Atlas API base URL (optional, for parts)
 *   ATLAS_API_USER      — Atlas admin email (optional)
 *   ATLAS_API_PASSWORD  — Atlas admin password (optional)
 *
 * Exit codes:
 *   0 — success
 *   1 — missing args or runtime error
 */

import { syncCmmsToKg } from "@/lib/knowledge-graph/cmms-sync";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");

if (!tenantId) {
  console.error("Usage: bun run scripts/kg-cmms-sync.ts --tenant-id <uuid>");
  process.exit(1);
}

if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL environment variable is required");
  process.exit(1);
}

console.log(`[kg-cmms-sync] Starting sync for tenant: ${tenantId}`);

try {
  const result = await syncCmmsToKg(tenantId);
  console.log("[kg-cmms-sync] Sync complete:");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error("[kg-cmms-sync] Fatal error:", err);
  process.exit(1);
}
