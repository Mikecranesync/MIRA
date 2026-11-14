#!/usr/bin/env node
/**
 * Seed ONE project's component checklist from a provisional inventory file
 * (default: scripts/data/cv101-provisional-inventory.json). Every row is saved
 * unconfirmed with no label text and no identity fields; what the schedule or an
 * earlier photo said is kept as the row's evidence note (bench-components/seed.ts).
 *
 * DRY RUN by default: prints the project's current checklist count and every row
 * it would add, with its fixed request id. It writes ONLY when BOTH are true:
 *   BENCH_COMPONENT_SEED=1   (the flag the owner sets on purpose)
 *   --apply                  (the explicit intent on the command line)
 *
 * Usage:
 *   npx tsx scripts/seed-bench-components.ts --tenant-id <uuid> --notebook-id <uuid> [--inventory <file>] [--apply]
 *
 * Safe to run again: a second run reports every row "existing" and adds nothing.
 * A refusal (project not found in that tenant, or a row id already used with a
 * different shape) stops the run at that row and exits 2.
 *
 * Needs the bench-components tables (proposed migration 115) in the target
 * database. Env required: NEON_DATABASE_URL. Reverse: there is no retire command
 * yet. Seeded rows carry created_by = 'seed:provisional-inventory' and the request
 * ids the dry run prints, so they can be found and retired by statement; dropping
 * the tables (migration 115's rollback block) removes everything.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import pool from "@/lib/db";
import { addComponent, listComponents } from "@/capabilities/bench-components/store";
import { SEED_USER, runSeed, seedInputs, type InventoryRow } from "@/capabilities/bench-components/seed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const tenantId = parseArg("--tenant-id");
  const notebookId = parseArg("--notebook-id");
  const file = parseArg("--inventory") ?? path.join(__dirname, "data", "cv101-provisional-inventory.json");
  const apply = process.argv.includes("--apply") && process.env.BENCH_COMPONENT_SEED === "1";

  if (!tenantId || !notebookId || !UUID.test(tenantId) || !UUID.test(notebookId)) {
    console.error("Usage: npx tsx scripts/seed-bench-components.ts --tenant-id <uuid> --notebook-id <uuid> [--inventory <file>] [--apply]");
    process.exit(1);
  }
  if (!process.env.NEON_DATABASE_URL) {
    console.error("Error: NEON_DATABASE_URL is required");
    process.exit(1);
  }
  if (process.argv.includes("--apply") && !apply) {
    console.error("Refusing to write: --apply requires BENCH_COMPONENT_SEED=1 in the environment.");
    process.exit(1);
  }

  const inventory = JSON.parse(readFileSync(file, "utf8")) as { inventory: string; rows: InventoryRow[] };
  const inputs = seedInputs(notebookId, inventory.rows);
  const before = await listComponents(tenantId, notebookId);
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${inventory.inventory} -> tenant=${tenantId} notebook=${notebookId}`);
  console.log(`checklist now: ${before.length} component(s); inventory rows: ${inputs.length}`);
  for (const i of inputs) console.log(`  ${String(i.position).padStart(2)} ${i.key.padEnd(18)} ${i.kind.padEnd(20)} ${i.origin.padEnd(15)} ${i.clientRequestId}`);
  if (!apply) return;

  const outcomes = await runSeed(
    (i) => addComponent(tenantId, notebookId, SEED_USER, { clientRequestId: i.clientRequestId, kind: i.kind, origin: i.origin, position: i.position, revision: i.revision }),
    inputs,
  );
  for (const o of outcomes) console.log(`  ${o.key.padEnd(18)} ${o.status}`);
  const after = await listComponents(tenantId, notebookId);
  console.log(`checklist after: ${after.length} component(s)`);
  if (outcomes.length < inputs.length || outcomes.some((o) => o.status !== "created" && o.status !== "existing")) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
