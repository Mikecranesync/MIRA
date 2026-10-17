import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #3880 + owner directive (Mike, 2026-10-14): new accounts default to the new
// interface. On 2026-10-14 a real-phone walk showed a brand-new staging account
// signing up, landing on /v3, and being bounced by the shell's own onboarding
// gate into the legacy /onboarding wizard. The phone never gates on the wizard
// (PRD §19.11), and a tenant with no namespace gets a cited answer on /v3 from an
// attached manual, so the shell must not send anyone to /onboarding.
//
// This is a STRUCTURAL tripwire over the shell's own sources: it fails if the
// deleted mechanism comes back (the gate component, a read of the wizard status,
// the onboarding decision helper, or a literal route to /onboarding). It cannot
// see a redirect assembled at runtime or issued from outside this directory. The
// runtime proof is elsewhere: the real middleware landing tests
// (capabilities/__tests__/hub-landing.test.ts) and the post-deploy staging walk.
// The hub's unit environment cannot load @factorylm/interaction, so the host
// itself is not rendered here.
const DIR = new URL("./", import.meta.url);
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => ({ f, text: readFileSync(new URL(f, DIR), "utf8") }));

const offending = (pattern: RegExp) => sources.filter(({ text }) => pattern.test(text)).map(({ f }) => f);

describe("the shell never bounces a technician into the legacy setup wizard", () => {
  it("the /v3 host renders the shell without an onboarding gate", () => {
    const host = readFileSync(new URL("./hub-host.tsx", DIR), "utf8");
    expect(host).not.toMatch(/OnboardingGate/);
    expect(host).toMatch(/<FactoryLMShell/);
  });

  it("no shell source reads the setup wizard's status or its redirect rule", () => {
    expect(offending(/\/api\/wizard\//)).toEqual([]);
    expect(offending(/shouldRedirectToOnboarding|@\/lib\/onboarding-flow/)).toEqual([]);
  });

  it("no shell source routes to /onboarding", () => {
    expect(offending(/["'`]\/onboarding\/?["'`]/)).toEqual([]);
  });

  it("control: the scan sees the shell sources, and each pattern bites", () => {
    expect(sources.map(({ f }) => f)).toContain("hub-host.tsx");
    const gate = 'await getJson("/api/wizard/company"); router.replace("/onboarding"); import { shouldRedirectToOnboarding } from "@/lib/onboarding-flow";';
    expect(/\/api\/wizard\//.test(gate)).toBe(true);
    expect(/["'`]\/onboarding\/?["'`]/.test(gate)).toBe(true);
    expect(/shouldRedirectToOnboarding|@\/lib\/onboarding-flow/.test(gate)).toBe(true);
  });
});
