#!/usr/bin/env bun
/**
 * Hierarchy backfill CLI shim (Phase 1, #806).
 *
 * Usage:
 *   bun run scripts/kg-hierarchy-backfill.ts --tenant-id <uuid> [--dry-run]
 *
 * Env required:
 *   NEON_DATABASE_URL — NeonDB connection string
 */

import { runHierarchyBackfill } from "@/lib/knowledge-graph/hierarchy-backfill";

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

const tenantId = parseArg("--tenant-id");
const dryRun = process.argv.includes("--dry-run");

if (!tenantId) {
  console.error("Usage: bun run scripts/kg-hierarchy-backfill.ts --tenant-id <uuid> [--dry-run]");
  process.exit(1);
}
if (!process.env.NEON_DATABASE_URL) {
  console.error("Error: NEON_DATABASE_URL is required");
  process.exit(1);
}

console.log(`[kg-hierarchy-backfill] tenant=${tenantId} dry-run=${dryRun}`);
try {
  const result = await runHierarchyBackfill(tenantId, dryRun);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error("[kg-hierarchy-backfill] Fatal:", err);
  process.exit(1);
}
