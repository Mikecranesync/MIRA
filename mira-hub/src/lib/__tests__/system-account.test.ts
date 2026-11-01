import { describe, expect, it } from "vitest";
import { isSystemAccount } from "../users";

describe("isSystemAccount", () => {
  it("flags the synthetic accounts seen in the prod admin list (Hub QA 2026-05-28 #8)", () => {
    const synthetic = [
      { email: "playwright-probe@factorylm.com", name: null },
      { email: "playwright@factorylm.com", name: null },
      { email: "drawer-test-001@factorylm.com", name: null },
      { email: "e2e-trial-42@factorylm.com", name: null },
      { email: "someone@factorylm.com", name: "NeonDB Proof" },
      { email: "someone@factorylm.com", name: "E2E Audit" },
    ];
    for (const u of synthetic) {
      expect(isSystemAccount(u), `${u.email} / ${u.name}`).toBe(true);
    }
  });

  it("does NOT flag real users", () => {
    const real = [
      { email: "harperhousebuyers@gmail.com", name: "Mike Harper" },
      { email: "mike@cranesync.com", name: "Mike" },
      { email: "latest.news@example.com", name: "Latest News" }, // contains "test" but not as a token
      { email: "ernesto@plant.com", name: "Ernesto" }, // contains "e2e"? no — guards against loose matches
      { email: "tech1@acme-manufacturing.com", name: "Plant Tech" },
    ];
    for (const u of real) {
      expect(isSystemAccount(u), `${u.email} / ${u.name}`).toBe(false);
    }
  });

  it("tolerates missing/empty fields", () => {
    expect(isSystemAccount({ email: "real@user.com", name: null })).toBe(false);
    expect(isSystemAccount({ email: "real@user.com", name: "" })).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isSystemAccount({ email: "PLAYWRIGHT-Probe@FactoryLM.com", name: null })).toBe(true);
    expect(isSystemAccount({ email: "x@y.com", name: "neondb proof" })).toBe(true);
  });
});
