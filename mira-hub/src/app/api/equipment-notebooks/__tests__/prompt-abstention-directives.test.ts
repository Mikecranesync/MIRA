/**
 * Prompt Abstention Directives (issue #3764).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/prompt-abstention-directives.test.ts
 *
 * Asserts that the system prompts contain explicit directives on plant-specific values
 * and abstention on missing nameplate/baseline/configuration data. These are the core
 * guardrails that prevent confident guessing on out-of-scope questions (tech-25/26/27).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { GENERAL_SYSTEM_PROMPT } from "@/app/api/equipment-notebooks/[id]/chat/route";

// Read the route file and extract the prompts
const routeFile = join(__dirname, "../[id]/chat/route.ts");
const routeText = readFileSync(routeFile, "utf-8");

describe("prompt abstention directives (#3764)", () => {
  it("BASE_SYSTEM_PROMPT contains PLANT-SPECIFIC VALUES section", () => {
    expect(routeText).toContain("PLANT-SPECIFIC VALUES");
    expect(routeText).toContain("nameplate data");
    expect(routeText).toContain("abstain");
  });

  it("BASE_SYSTEM_PROMPT directs abstention on relief valve setpoints", () => {
    expect(routeText).toContain("relief valve setpoint");
  });

  it("BASE_SYSTEM_PROMPT directs abstention on motor baselines", () => {
    expect(routeText).toContain("baseline history");
  });

  it("BASE_SYSTEM_PROMPT directs abstention on pump suction limits", () => {
    expect(routeText).toContain("pump suction lift");
  });

  it("BASE_SYSTEM_PROMPT distinguishes plant-specific from generic knowledge", () => {
    expect(routeText).toContain("Generic knowledge");
    expect(routeText).toContain("Plant-specific values");
  });

  it("GENERAL_SYSTEM_PROMPT strengthened HONESTY section mentions plant-specific values", () => {
    expect(routeText).toContain("plant-specific values");
  });

  // Codex #4891 F9 (round 5 — architectural inversion): these five checks
  // used to regex the raw SOURCE TEXT of route.ts between its literal
  // "HONESTY:"/"SAFETY:" header strings. That stopped working once the
  // restatable compatibility/site-records sentences were carved into their
  // own named constants (GENERAL_COMPATIBILITY_CAUTION/GENERAL_SITE_RECORDS_
  // CAUTION) and spliced back via template interpolation (`${...}`) — the
  // raw SOURCE now reads the interpolation expression, not the literal
  // words, even though the RENDERED prompt (what the model actually
  // receives) is byte-identical to before. Asserting against the evaluated
  // `GENERAL_SYSTEM_PROMPT` constant (imported above) tests the thing that
  // actually matters — the rendered text the technician's turn is built
  // from — and is robust to any future carve-out of this kind.
  it("GENERAL_SYSTEM_PROMPT directs abstention on relief valve setpoint", () => {
    const honesty = GENERAL_SYSTEM_PROMPT.match(/HONESTY:([\s\S]*?)SAFETY:/);
    expect(honesty).toBeTruthy();
    expect(honesty![1]).toContain("relief valve setpoint");
  });

  it("GENERAL_SYSTEM_PROMPT directs abstention on motor baseline current", () => {
    const honesty = GENERAL_SYSTEM_PROMPT.match(/HONESTY:([\s\S]*?)SAFETY:/);
    expect(honesty).toBeTruthy();
    expect(honesty![1]).toContain("motor baseline");
  });

  it("GENERAL_SYSTEM_PROMPT directs abstention on pump suction lift limit", () => {
    const honesty = GENERAL_SYSTEM_PROMPT.match(/HONESTY:([\s\S]*?)SAFETY:/);
    expect(honesty).toBeTruthy();
    expect(honesty![1]).toContain("pump suction lift");
  });

  it("GENERAL_SYSTEM_PROMPT directs abstention on compressor pressure", () => {
    const honesty = GENERAL_SYSTEM_PROMPT.match(/HONESTY:([\s\S]*?)SAFETY:/);
    expect(honesty).toBeTruthy();
    expect(honesty![1]).toContain("compressor pressure");
  });

  it("GENERAL_SYSTEM_PROMPT mentions nameplate data requirement", () => {
    const honesty = GENERAL_SYSTEM_PROMPT.match(/HONESTY:([\s\S]*?)SAFETY:/);
    expect(honesty).toBeTruthy();
    expect(honesty![1]).toContain("nameplate");
  });

  it("Both prompts forbid guessing generic values for plant-specific data", () => {
    expect(routeText).toContain("Do NOT guess");
    expect(routeText).toContain("generic value");
  });
});
