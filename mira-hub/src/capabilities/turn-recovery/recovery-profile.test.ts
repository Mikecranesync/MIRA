/** Native round4 F7 — the recovery suites run only in an explicit disposable profile. DB-free. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RECOVERY_PROFILE, recoveryTestDatabaseUrl } from "../../../scripts/recovery-test-database.mjs";

const ok = "postgres://postgres@127.0.0.1:55572/tech_recovery";
const root = path.resolve(__dirname, "../../..");
const suites = ["status", "chat", "round2"].map(name => `${name}.integration.test.ts`);

describe("turn-recovery integration profile guard", () => {
  it("accepts only the confirmed profile with a canonical loopback database", () => {
    expect(recoveryTestDatabaseUrl(ok, "DISPOSABLE", RECOVERY_PROFILE)).toBe(ok);
    expect(recoveryTestDatabaseUrl("postgres://u@localhost:5/x", "DISPOSABLE", RECOVERY_PROFILE)).toBe("postgres://u@127.0.0.1:5/x");
  });
  it.each([
    ["no profile marker (shared-dev / default config)", ok, "DISPOSABLE", ""],
    ["a different profile", ok, "DISPOSABLE", "equipment-browser"],
    ["no disposable confirmation", ok, "", RECOVERY_PROFILE],
    ["a remote host", "postgres://u@ep-lingering-salad.neon.tech/x", "DISPOSABLE", RECOVERY_PROFILE],
    ["a staging-named database", "postgres://u@127.0.0.1:5/staging_db", "DISPOSABLE", RECOVERY_PROFILE],
    ["connection options", "postgres://u@127.0.0.1:5/x?host=evil.example", "DISPOSABLE", RECOVERY_PROFILE],
    ["no URL at all", undefined, "DISPOSABLE", RECOVERY_PROFILE],
  ])("rejects %s before any connection exists", (_name, url, confirm, profile) => {
    expect(() => recoveryTestDatabaseUrl(url as string, confirm, profile)).toThrow();
  });
});

describe("turn-recovery integration profile wiring", () => {
  it.each(suites)("%s validates through the shared guard before building its pool", name => {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    const guard = source.indexOf("recoveryTestDatabaseUrl(process.env.TEST_DATABASE_URL");
    const pool = source.indexOf("new PgPool");
    expect(guard).toBeGreaterThan(-1);
    expect(pool).toBeGreaterThan(guard);
    expect(source).toContain("process.env.MIRA_TEST_PROFILE");
  });
  it("the default/shared-dev integration config excludes them and the recovery config selects exactly them", () => {
    expect(fs.readFileSync(path.join(root, "vitest.integration.config.ts"), "utf8")).toContain('"src/capabilities/turn-recovery/**/*.integration.test.ts"');
    const profile = fs.readFileSync(path.join(root, "vitest.turn-recovery.config.ts"), "utf8");
    for (const name of suites) expect(profile).toContain(`src/capabilities/turn-recovery/${name}`);
    expect(profile).toContain("MIRA_TEST_PROFILE: RECOVERY_PROFILE");
  });
  it("is the only script that provisions and runs the profile; shared-dev never names it", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
    expect(pkg["test:integration:turn-recovery"]).toContain("vitest.turn-recovery.config.ts");
    expect(fs.readFileSync(path.join(root, "scripts/run-dev-integration-tests.mjs"), "utf8")).not.toContain("turn-recovery");
  });
});
