import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * #2178 regression guard for `/api/hub/ask`.
 *
 * `knowledge_entries` is a HYBRID corpus: the shared OEM library lives under
 * the system tenant with `is_private = false`, and `retrieveManualChunks`
 * filters `(is_private = false OR tenant_id = $1)`.
 *
 * `withTenantContext` issues `SET LOCAL ROLE factorylm_app`, activating the RLS
 * policy `tenant_id = current_setting('app.current_tenant_id')`
 * (003_kb_hardening.sql:52). RLS ANDs on top of the hybrid predicate and
 * collapses it to `tenant_id = $caller`, hiding every OEM row. A customer then
 * sees ZERO manuals for every manufacturer and MIRA refuses politely.
 *
 * The first version of this route did exactly that, copied from
 * `/api/quickstart/ask` — a shape that is safe there ONLY because quickstart
 * passes `quickstartTenantId()`, so it is the corpus owner and RLS returns its
 * own rows. This route passes the CUSTOMER's tenant, where the identical call
 * has the opposite effect.
 *
 * Why this is a source-level assertion rather than a query test: the defect is
 * invisible at the SQL layer. The predicate is correct in both versions — what
 * differs is the CONNECTION the query runs on. A test that mocks the client
 * cannot see it, which is precisely why #2178 shipped once already.
 */
const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(resolve(here, "../route.ts"), "utf8");
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/api/hub/ask — the hybrid corpus must stay visible (#2178)", () => {
  it("the comment stripper actually strips (positive control)", () => {
    // Without this, every assertion below would be scanning documentation that
    // deliberately NAMES the forbidden call.
    expect(route).toContain("#2178");
    expect(code).not.toContain("#2178");
  });

  it("does NOT run retrieval through withTenantContext", () => {
    expect(code).not.toContain("withTenantContext");
  });

  it("takes its client from the raw owner pool", () => {
    expect(code).toContain("pool.connect()");
  });

  it("still passes the CALLER's tenant as the predicate argument", () => {
    // The hybrid predicate supplies tenant scoping; bypassing RLS must not
    // bypass tenancy. Dropping this argument would make it a global read.
    expect(code).toMatch(/retrieveManualChunks\(\s*client,\s*ctx\.tenantId/);
  });

  it("releases the client on every path", () => {
    expect(code).toContain("finally");
    expect(code).toContain("client.release()");
  });

  it("does not swallow the tenant into a hardcoded corpus owner", () => {
    // The inverse failure: scoping to the system tenant would show every
    // customer the library but hide their own uploads.
    expect(code).not.toContain("quickstartTenantId");
    expect(code).not.toContain("SHARED_TENANT_ID");
  });
});
