/**
 * Tenant projection guard.
 *
 * The 410 soft-delete branch in `gateOnTiers` (src/lib/auth.ts) reads
 * `tenant.deleted_at`. It was dead code for as long as the tenant loaders in
 * quota.ts did not SELECT that column — the exact way the original defect
 * arose (auth.ts declared the check; the projection never supplied the field,
 * so the branch could never fire and soft-deleted accounts were blocked only
 * incidentally, by `tier = 'churned'`).
 *
 * This is a source-level assertion on purpose. A runtime test would need the
 * REAL quota.js, but sibling suites install a process-global
 * `mock.module("../../lib/quota.js", …)` (bun:test design), so a runtime
 * import of quota.js is not reliably the real module when the whole suite
 * runs together. Asserting on the SQL text is deterministic, covers all four
 * loaders at once, and fails loudly if a future refactor drops the column.
 */
import { describe, test, expect } from "bun:test";

const QUOTA_SRC = await Bun.file(
  new URL("../quota.ts", import.meta.url)
).text();

const LOADERS = [
  "findTenantByEmail",
  "findTenantById",
  "findTenantByStripeCustomerId",
  "findTenantByInboxSlug",
];

describe("plg_tenants projection includes deleted_at", () => {
  test("the Tenant interface declares deleted_at", () => {
    expect(QUOTA_SRC).toContain("deleted_at: string | null;");
  });

  for (const loader of LOADERS) {
    test(`${loader} selects deleted_at`, () => {
      const start = QUOTA_SRC.indexOf(`export async function ${loader}(`);
      expect(start).toBeGreaterThan(-1);
      const end = QUOTA_SRC.indexOf("FROM plg_tenants", start);
      expect(end).toBeGreaterThan(start);
      const projection = QUOTA_SRC.slice(start, end);
      expect(projection).toContain("deleted_at");
    });
  }
});
