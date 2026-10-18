/**
 * #4498 Phase 1 is inert: nothing in the Hub may import the diagnostic-plan
 * module except the module itself and its own tests. Wiring it into a runtime
 * path (chat route, notebook routes, UI) is a later, separately reviewed slice.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const MODULE_DIR = join("capabilities", "diagnostic-plan") + sep;
// Every module-loading form that names the module: `from "…"` (import and re-export), a bare
// side-effect `import "…"`, dynamic `import("…")`, and CommonJS `require("…")`.
const IMPORT_RE =
  /from\s+["'][^"']*diagnostic-plan[^"']*["']|\bimport\s+["'][^"']*diagnostic-plan|\b(?:import|require)\(\s*["'][^"']*diagnostic-plan/;

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
    .filter((rel) => IMPORT_RE.test(readFileSync(join(srcRoot, rel), "utf8")));
}

describe("diagnostic-plan stays inert (#4498 Phase 1)", () => {
  it("is imported by nothing outside its own directory and tests", () => {
    expect(importersOf(SRC)).toEqual([]);
  });

  it("the import matcher catches a real import and ignores the unrelated wizard nextStep", () => {
    expect(IMPORT_RE.test('import { nextStep } from "@/capabilities/diagnostic-plan";')).toBe(true);
    expect(IMPORT_RE.test('const m = await import("../capabilities/diagnostic-plan/runner");')).toBe(true);
    expect(IMPORT_RE.test('import "@/capabilities/diagnostic-plan";')).toBe(true);
    expect(IMPORT_RE.test('const { nextStep } = require("@/capabilities/diagnostic-plan");')).toBe(true);
    expect(IMPORT_RE.test("export * from '../capabilities/diagnostic-plan/types';")).toBe(true);
    expect(IMPORT_RE.test("const next = nextStep(current);")).toBe(false);
  });
});
