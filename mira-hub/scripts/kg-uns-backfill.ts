#!/usr/bin/env bun
/**
 * UNS path backfill CLI shim (CRA-14).
 *
 * Computes uns_path for every plant/area/line/equipment/component entity
 * in the given tenant by walking parent_of edges to the plant root and
 * concatenating sanitized labels.
 *
 * Usage:
 *   bun run scripts/kg-uns-backfill.ts --tenant-id <uuid> [--dry-run]
 *
 * Env required:
 *   NEON_DATABASE_URL — NeonDB connection string
 */

import { runUnsBackfill } from "@/lib/knowledge-graph/uns-backfill";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");
const dryRun = process.argv.includes("--dry-run");

if (!tenantId) {
  console.error("Usage: bun run scripts/kg-uns-backfill.ts --tenant-id <uuid> [--dry-run]");
  process.exit(1);
}
if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL is required");
  process.exit(1);
}

console.log(`[kg-uns-backfill] tenant=${tenantId} dry-run=${dryRun}`);
try {
  const result = await runUnsBackfill(tenantId, dryRun);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error("[kg-uns-backfill] Fatal:", err);
  process.exit(1);
}
