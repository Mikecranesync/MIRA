import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const passwordHelper = readFileSync(resolve(repoRoot, "scripts/set-qa-member-password.ts"), "utf8");
const secretShopperRunbook = readFileSync(resolve(repoRoot, "../docs/runbooks/secret-shopper-testing-setup.md"), "utf8");

describe("Hermes QA credential helper", () => {
  it("accepts Hermes-specific credential env vars without printing secrets", () => {
    expect(passwordHelper).toContain("process.env.HERMES_HUB_EMAIL");
    expect(passwordHelper).toContain("process.env.HERMES_HUB_PASSWORD");
    expect(passwordHelper).toContain("password itself NOT printed");
    expect(passwordHelper).not.toContain("console.log(QA_PASSWORD");
  });

  it("fails loudly before prod writes unless the operator confirms the action", () => {
    expect(passwordHelper).toContain('const CONFIRM_TOKEN = "SET_QA_MEMBER_PASSWORD_PROD"');
    expect(passwordHelper).toContain("require QA_CONFIRM=");
    expect(passwordHelper).toContain("QA_PASSWORD.length < 16");
    expect(passwordHelper).toContain("FORBIDDEN_PASSWORD_PATTERNS");
    expect(passwordHelper).toContain("LOCAL_WEAK_PASSWORD");
  });

  it("verifies the exact target row was updated", () => {
    expect(passwordHelper).toContain("WHERE id = $2 AND tenant_id = $3");
    expect(passwordHelper).toContain("if (result.rowCount !== 1)");
    expect(passwordHelper).toContain("password_hash IS NOT NULL");
    expect(passwordHelper).toContain("Refusing: target member is not approved");
  });

  it("documents the Hermes handoff without committing the password", () => {
    expect(secretShopperRunbook).toContain("HERMES_HUB_EMAIL");
    expect(secretShopperRunbook).toContain("HERMES_HUB_PASSWORD");
    expect(secretShopperRunbook).toContain("QA_CONFIRM=SET_QA_MEMBER_PASSWORD_PROD");
    expect(secretShopperRunbook).toContain("Do not commit or paste the password");
  });
});
