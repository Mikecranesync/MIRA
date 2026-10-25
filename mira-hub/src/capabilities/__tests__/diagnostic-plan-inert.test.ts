/**
 * #4498 Phase 1 shipped inert. WP-1 (Mike, 2026-10-21) is the first, separately reviewed wiring:
 * guided troubleshooting on the notebook. Exactly the files below may import the module; any other
 * importer (the chat route above all) is still a new slice that must update this list in review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const MODULE_DIR = join("capabilities", "diagnostic-plan") + sep;
// The module specifiers a file actually loads, read by TypeScript's own import scanner: static
// and side-effect imports, re-exports, dynamic `import()` and `require()`, with comments between
// the tokens allowed. Text in comments or string literals is never a specifier (#4510 Codex r3).
function namesModule(src: string): boolean {
  return ts.preProcessFile(src, true, true).importedFiles.some((f) => f.fileName.includes("diagnostic-plan"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function isOwnFile(rel: string): boolean {
  return rel.startsWith(MODULE_DIR) || /^capabilities[\\/]__tests__[\\/]diagnostic-plan-[^\\/]+\.test\.ts$/.test(rel);
}

function importersOf(srcRoot: string): string[] {
  return walk(srcRoot)
    .map((f) => relative(srcRoot, f))
    .filter((rel) => !isOwnFile(rel))
    .filter((rel) => namesModule(readFileSync(join(srcRoot, rel), "utf8")));
}

// Relative to mira-hub/src. Adding a line here is the review signal for a new runtime consumer.
const APPROVED_IMPORTERS = [
  join("app", "api", "equipment-notebooks", "[id]", "procedure", "route.ts"),
  join("capabilities", "guided-procedure-store.ts"),
  join("factorylm-ui", "GuidedProcedure.tsx"),
].sort();

describe("diagnostic-plan importers are exactly the approved WP-1 wiring (#4498)", () => {
  it("is imported only by the approved WP-1 files outside its own directory and tests", () => {
    expect(importersOf(SRC).sort()).toEqual(APPROVED_IMPORTERS);
  });

  it("the import matcher catches a real import and ignores the unrelated wizard nextStep", () => {
    expect(namesModule('import { nextStep } from "@/capabilities/diagnostic-plan";')).toBe(true);
    expect(namesModule('const m = await import("../capabilities/diagnostic-plan/runner");')).toBe(true);
    expect(namesModule('import "@/capabilities/diagnostic-plan";')).toBe(true);
    expect(namesModule('const { nextStep } = require("@/capabilities/diagnostic-plan");')).toBe(true);
    expect(namesModule("export * from '../capabilities/diagnostic-plan/types';")).toBe(true);
    expect(namesModule("const next = nextStep(current);")).toBe(false);
  });

  it("sees imports with comments inside them and ignores the module named only in comments or strings (#4510 Codex r3)", () => {
    const names = namesModule;
    expect(names('const m = await import(/* webpackChunkName: "plan" */ "@/capabilities/diagnostic-plan");')).toBe(true);
    expect(names('const m = require /* lazy */ ("@/capabilities/diagnostic-plan");')).toBe(true);
    expect(names('// import "@/capabilities/diagnostic-plan";\nexport const x = 1;')).toBe(false);
    expect(names(`const doc = 'import "@/capabilities/diagnostic-plan"';`)).toBe(false);
  });
});
