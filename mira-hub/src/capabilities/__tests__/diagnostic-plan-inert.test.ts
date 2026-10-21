/**
 * #4498 Phase 1 is inert: nothing in the Hub may import the diagnostic-plan
 * module except the module itself and its own tests. Wiring it into a runtime
 * path (chat route, notebook routes, UI) is a later, separately reviewed slice.
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

describe("diagnostic-plan stays inert (#4498 Phase 1)", () => {
  it("is imported by nothing outside its own directory and tests", () => {
    expect(importersOf(SRC)).toEqual([]);
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
