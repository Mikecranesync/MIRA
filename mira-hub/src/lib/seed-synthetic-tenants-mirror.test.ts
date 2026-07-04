import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the synthetic seeder must mirror both synthetic tenants into the
 * data-side `tenants` table.
 *
 * Real signup (src/lib/users.ts, #1899b) mirrors hub_tenants -> tenants (the FK
 * target of knowledge_entries.tenant_id). The seeder originally skipped this, so
 * EVERY QA-persona document upload 23503'd on knowledge_entries_tenant_id_fkey
 * ("Server storage error") — the beta-gate journey (upload manual -> cited
 * answer) could not run on a QA tenant, and the dogfood contextualization path
 * showed "0 customer documents". The mirror was added; this test is Phase 3 of
 * the dogfood-routine durability plan, protecting it from silent removal.
 *
 * Static (reads the seeder source) rather than a DB integration test: cheap,
 * runs in the existing Hub Unit vitest, and it precisely catches "someone
 * deleted the mirror".
 */
describe("seed-synthetic-users tenants mirror (#1899b / dogfood beta-gate)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/seed-synthetic-users.ts"),
    "utf8",
  );

  it("mirrors BOTH synthetic tenants into the data-side tenants table", () => {
    const inserts = src.match(/INSERT INTO tenants\b/g) ?? [];
    expect(
      inserts.length,
      "seeder must INSERT INTO tenants for BOTH synthetic tenants (primary + isolation) — " +
        "dropping this re-breaks QA uploads with a knowledge_entries_tenant_id_fkey 23503",
    ).toBeGreaterThanOrEqual(2);
  });

  it("provides contact_email (the NOT NULL column) on the tenants insert", () => {
    // tenants.name + contact_email are NOT NULL with no default; omitting either
    // would fail the insert and silently roll back the mirror.
    expect(/INSERT INTO tenants \(id, name, contact_email\)/.test(src)).toBe(true);
  });
});
