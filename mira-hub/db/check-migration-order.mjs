#!/usr/bin/env node
// mira-hub/db/check-migration-order.mjs
//
// Verifies that migration files are numbered in a valid dependency order.
// Reads every .sql file in db/migrations/, extracts the "-- Issue: #NNN" header,
// and cross-references against the dep map below.
//
// Usage:  node db/check-migration-order.mjs
// CI:     npm run db:check-order
//
// Exit 0 = order is valid.
// Exit 1 = a migration references a table that is only created by a later file.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// ---------------------------------------------------------------------------
// Dependency map — hand-maintained.
//
// Each entry: { file: regex matching filename, issue: "#NNN", deps: ["#NNN", ...] }
// "deps" = issue numbers whose migrations MUST have a lower sort position.
//
// Update this map when a new migration is added.
// ---------------------------------------------------------------------------
const DEP_MAP = [
  { pattern: /002-asset-hierarchy/,  issue: "#562", deps: [] },
  { pattern: /003-failure-codes/,    issue: "#568", deps: [] },
  { pattern: /004-pms/,              issue: "#566", deps: ["#562"] },
  { pattern: /005-work-orders/,      issue: "#565", deps: ["#562", "#568", "#566"] },
  { pattern: /006-llm-keys/,         issue: "#574", deps: [] },
  { pattern: /007-webhooks/,         issue: "#576", deps: [] },
  { pattern: /008-tenants-rls/,      issue: "#578", deps: ["#562", "#565", "#566", "#568", "#574", "#576"] },
  { pattern: /009-sso/,              issue: "#579", deps: ["#578"] },
  { pattern: /010-pwa-sync/,         issue: "#575", deps: ["#565"] },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function extractIssue(content) {
  const match = content.match(/--\s*Issue:\s*(#\d+)/i);
  return match ? match[1] : null;
}

function run() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log(`[check-migration-order] ${MIGRATIONS_DIR} does not exist — skipping.`);
    process.exit(0);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort(); // lexicographic = NNN order

  if (files.length === 0) {
    console.log("[check-migration-order] No migration files found — skipping.");
    process.exit(0);
  }

  // Map filename → position (0-indexed)
  const fileOrder = new Map(files.map((f, i) => [f, i]));

  // Map issue → filename (from file headers)
  const issueToFile = new Map();
  for (const file of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const issue = extractIssue(content);
    if (issue) issueToFile.set(issue, file);
  }

  // Map pattern → filename (from dep map)
  const patternToFile = new Map();
  for (const file of files) {
    for (const entry of DEP_MAP) {
      if (entry.pattern.test(file)) {
        patternToFile.set(entry.issue, file);
        break;
      }
    }
  }

  let failures = 0;

  for (const entry of DEP_MAP) {
    const thisFile = patternToFile.get(entry.issue);
    if (!thisFile) continue; // not yet landed, skip

    const thisPos = fileOrder.get(thisFile);

    for (const depIssue of entry.deps) {
      const depFile = patternToFile.get(depIssue);
      if (!depFile) {
        console.error(
          `[FAIL] ${thisFile} (${entry.issue}) depends on ${depIssue} ` +
          `but no migration for ${depIssue} found in ${MIGRATIONS_DIR}.`
        );
        failures++;
        continue;
      }

      const depPos = fileOrder.get(depFile);
      if (depPos >= thisPos) {
        console.error(
          `[FAIL] Order violation: ${thisFile} (${entry.issue}) depends on ` +
          `${depFile} (${depIssue}), but ${depFile} sorts AFTER ${thisFile}. ` +
          `Rename files so the NNN prefix puts dependencies first.`
        );
        failures++;
      } else {
        console.log(`[OK]   ${thisFile} after ${depFile} ✓`);
      }
    }

    if (entry.deps.length === 0) {
      console.log(`[OK]   ${thisFile} (no deps) ✓`);
    }
  }

  // Warn about files not in DEP_MAP
  for (const file of files) {
    const known = DEP_MAP.some(e => e.pattern.test(file));
    if (!known) {
      console.warn(
        `[WARN] ${file} is not in the dep map — add an entry to DEP_MAP ` +
        `in db/check-migration-order.mjs before merging.`
      );
    }
  }

  if (failures > 0) {
    console.error(`\n[check-migration-order] ${failures} violation(s). Fix file numbering before merging.`);
    process.exit(1);
  }

  console.log("\n[check-migration-order] All dependency order checks passed.");
}

run();
