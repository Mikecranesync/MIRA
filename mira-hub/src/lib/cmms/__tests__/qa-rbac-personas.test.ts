import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const hubRoot = resolve(here, "../../../..");
const repoRoot = resolve(hubRoot, "..");
const seedScript = readFileSync(resolve(hubRoot, "scripts/seed-synthetic-users.ts"), "utf8");
const loginHelper = readFileSync(resolve(repoRoot, "dogfood-output/qa-login-save-state.mjs"), "utf8");
const qaRunbook = readFileSync(resolve(repoRoot, "tools/qa/README.md"), "utf8");

describe("QA credentialed persona coverage", () => {
  it("seeds one durable persona for every tenant RBAC role", () => {
    for (const role of ["technician", "manager", "scheduler", "admin", "operator", "owner"]) {
      expect(seedScript).toContain(`role: "${role}"`);
    }
    expect(seedScript).toContain("SYNTHETIC_SCHEDULER_PASSWORD");
    expect(seedScript).toContain("SYNTHETIC_OPERATOR_PASSWORD");
  });

  it("re-seeding updates role and password state instead of preserving stale owner rows", () => {
    expect(seedScript).toContain("password_hash = EXCLUDED.password_hash");
    expect(seedScript).toContain("role   = EXCLUDED.role");
    expect(seedScript).toContain("status = EXCLUDED.status");
  });

  it("seeds a separate tenant login for cross-tenant isolation probes", () => {
    expect(seedScript).toContain("SYNTH_ISOLATION_TENANT_ID");
    expect(seedScript).toContain("isolation@synthetic.test");
    expect(seedScript).toContain("SYNTHETIC_ISOLATION_PASSWORD");
  });

  it("fails the login helper unless a real session cookie exists", () => {
    expect(loginHelper).toContain("ctx.storageState");
    expect(loginHelper).toContain("c.name.includes('session-token')");
    expect(loginHelper).toContain("hasSessionToken");
    expect(loginHelper).toContain("process.exit(1)");
    expect(loginHelper).toContain("landed");
    expect(loginHelper).not.toContain("JSON.stringify({ ok: true, url: page.url()");
  });

  it("documents #2331 role-matrix credentials and the human-owned platform-admin gap", () => {
    expect(qaRunbook).toContain("RBAC matrix");
    expect(qaRunbook).toContain("SYNTHETIC_SCHEDULER_PASSWORD");
    expect(qaRunbook).toContain("SYNTHETIC_OPERATOR_PASSWORD");
    expect(qaRunbook).toContain("Platform admin");
    expect(qaRunbook).toContain("human-owned");
  });
});
