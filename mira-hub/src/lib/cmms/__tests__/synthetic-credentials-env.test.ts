import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const seedScript = readFileSync(resolve(here, "../../../../scripts/seed-synthetic-users.ts"), "utf8");
const syntheticDaySpec = readFileSync(resolve(here, "../../../../tests/e2e/synthetic-day.spec.ts"), "utf8");

describe("Synthetic user credentials", () => {
  it("can be sourced from Doppler/env for live proof runs", () => {
    expect(seedScript).toContain("process.env.HUB_SYNTHETIC_PASSWORD");
    expect(seedScript).toContain("process.env.SYNTHETIC_USER_PASSWORD");
    expect(seedScript).toContain("process.env.SYNTHETIC_CARLOS_PASSWORD");
    expect(seedScript).toContain('passwordEnv: "SYNTHETIC_CARLOS_PASSWORD"');
    expect(seedScript).toContain('passwordEnv: "SYNTHETIC_DANA_PASSWORD"');
    expect(seedScript).toContain('passwordEnv: "SYNTHETIC_PLANTMGR_PASSWORD"');
    expect(seedScript).toContain('passwordEnv: "SYNTHETIC_CFO_PASSWORD"');
    expect(seedScript).toContain("password sources = ");
    expect(seedScript).not.toContain("password = \" + TEST_PASSWORD");
    expect(seedScript).not.toContain("password = \" + SHARED_TEST_PASSWORD");

    expect(syntheticDaySpec).toContain("process.env.HUB_SYNTHETIC_PASSWORD");
    expect(syntheticDaySpec).toContain("process.env.SYNTHETIC_USER_PASSWORD");
    expect(syntheticDaySpec).toContain("const hasSharedPassword");
    expect(syntheticDaySpec).toContain("process.env.SYNTHETIC_CARLOS_PASSWORD");
    expect(syntheticDaySpec).toContain("process.env.SYNTHETIC_DANA_PASSWORD");
    expect(syntheticDaySpec).toContain("process.env.SYNTHETIC_PLANTMGR_PASSWORD");
    expect(syntheticDaySpec).toContain("process.env.SYNTHETIC_CFO_PASSWORD");
  });
});
