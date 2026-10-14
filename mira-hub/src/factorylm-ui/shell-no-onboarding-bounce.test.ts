import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #3880 + owner directive (Mike, 2026-10-14): new accounts default to the new
// interface. On 2026-10-14 a real-phone walk showed a brand-new staging account
// signing up, landing on /v3, and being bounced by the shell's own onboarding
// gate into the legacy /onboarding wizard. The phone never gates on the wizard
// (PRD §19.11), and a tenant with no namespace gets a cited answer on /v3 from an
// attached manual, so the shell must not send anyone to /onboarding.
const DIR = new URL("./", import.meta.url);
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => ({ f, text: readFileSync(new URL(f, DIR), "utf8") }));

describe("the shell never bounces a technician into the legacy setup wizard", () => {
  it("the /v3 host renders the shell without an onboarding gate", () => {
    const host = readFileSync(new URL("./hub-host.tsx", DIR), "utf8");
    expect(host).not.toMatch(/OnboardingGate/);
    expect(host).toMatch(/<FactoryLMShell/);
  });

  it("no shell source routes to /onboarding", () => {
    const offenders = sources.filter(({ text }) => /["'`]\/onboarding\/?["'`]/.test(text)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it("control: the scan sees the shell sources", () => {
    expect(sources.map(({ f }) => f)).toContain("hub-host.tsx");
  });
});
