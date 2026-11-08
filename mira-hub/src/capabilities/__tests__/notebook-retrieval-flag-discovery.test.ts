/**
 * Flag discovery (#5167): undeclared NOTEBOOK_* reads on the retrieveNodeChunks
 * import graph must fail the guard, including process.env["NOTEBOOK_X"].
 *
 * Declared names stay in notebook-retrieval-flag-guard.test.ts (FLAGS). This
 * file walks production imports instead of a hand-kept source list.
 *
 * Run: bunx vitest run src/capabilities/__tests__/notebook-retrieval-flag-discovery.test.ts
 */
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/**
 * Production roots whose NOTEBOOK_* reads change retrieveNodeChunks. The walker
 * follows their transitive @/ and relative imports so a new helper cannot hide
 * an undeclared flag. query-rewrite.ts is a second root because the chat route
 * feeds rewrittenQuery into retrieveNodeChunks. Only external packages, JSON,
 * type-only imports and test/declaration files are outside the production walk.
 */
const WALK_ROOTS = ["lib/manual-rag.ts", "capabilities/query-rewrite.ts"];

const parse = (source: string, filename = "source.ts") => ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const FLAG_NAME = /^NOTEBOOK_[A-Z0-9_]+$/;

function notebookEnvReads(source: string, filename?: string): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const target = node.expression;
      if (ts.isPropertyAccessExpression(target) && target.name.text === "env"
        && ts.isIdentifier(target.expression) && target.expression.text === "process") {
        const name = ts.isPropertyAccessExpression(node) ? node.name.text
          : node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
            ? node.argumentExpression.text : undefined;
        if (name && FLAG_NAME.test(name)) out.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source, filename));
  return out;
}

function importedSpecs(source: string, filename?: string): string[] {
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every((entry) => entry.isTypeOnly));
      if (!typeOnly && ts.isStringLiteralLike(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node)) {
      const bindings = node.exportClause;
      const typeOnly = node.isTypeOnly || (bindings && ts.isNamedExports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every((entry) => entry.isTypeOnly));
      if (!typeOnly && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)) specs.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specs.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(parse(source, filename));
  return specs;
}

function resolveSpec(fromRel: string, spec: string, overlay: Map<string, string>): string | null {
  if ((!spec.startsWith("@/") && !spec.startsWith(".")) || spec.endsWith(".json")) return null;
  const fromSourceRoot = (file: string) => relative(SRC(""), file).replace(/\\/g, "/");
  // Omitting directoryExists lets virtual fixture directories resolve via fileExists.
  const host: ts.ModuleResolutionHost = {
    fileExists: (file) => overlay.has(fromSourceRoot(file)) || ts.sys.fileExists(file),
    readFile: (file) => overlay.get(fromSourceRoot(file)) ?? ts.sys.readFile(file),
  };
  const resolved = ts.resolveModuleName(spec, SRC(fromRel), {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: SRC(""),
    paths: { "@/*": ["*"] },
  }, host).resolvedModule;
  if (!resolved) throw new Error(`Unresolved production import ${spec} in ${fromRel}`);
  const rel = fromSourceRoot(resolved.resolvedFileName);
  if (rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Import escapes source tree: ${spec}`);
  if (rel.includes("/__tests__/") || /\.(?:test|d)\.tsx?$/.test(rel)) return null;
  return rel;
}

function discoverNotebookReads(overlay: Map<string, string> = new Map()): Set<string> {
  const queue = [...WALK_ROOTS];
  const seen = new Set<string>();
  const reads = new Set<string>();
  while (queue.length) {
    const rel = queue.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = overlay.get(rel) ?? readFileSync(SRC(rel), "utf8");
    for (const f of notebookEnvReads(source, rel)) reads.add(f);
    for (const spec of importedSpecs(source, rel)) {
      const next = resolveSpec(rel, spec, overlay);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return reads;
}

/** FLAGS keys in the behavioral guard are the declared-name source of truth. */
function declaredFlags(source = readFileSync(SRC("lib/__tests__/notebook-retrieval-flag-guard.test.ts"), "utf8")): Set<string> {
  const declaration = parse(source).statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === "FLAGS");
  const initializer = declaration?.initializer;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) throw new Error("FLAGS must be a static object literal");
  const names = initializer.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name))
      || !FLAG_NAME.test(property.name.text)) throw new Error("FLAGS keys must be static NOTEBOOK_* names");
    return property.name.text;
  });
  expect(names.length, "FLAGS keys").toBeGreaterThan(0);
  return new Set(names);
}

describe("NOTEBOOK_* discovery from retrieveNodeChunks imports (#5167)", () => {
  it("fixture: dotted process.env.NOTEBOOK_X", () => {
    expect([...notebookEnvReads('const x = process.env.NOTEBOOK_FIXTURE_DOT === "1";')]).toEqual([
      "NOTEBOOK_FIXTURE_DOT",
    ]);
  });

  it("fixture: bracket process.env[\"NOTEBOOK_X\"]", () => {
    expect([...notebookEnvReads('const x = process.env["NOTEBOOK_FIXTURE_BRACKET"] === "1";')]).toEqual([
      "NOTEBOOK_FIXTURE_BRACKET",
    ]);
  });

  it("fixture: bracket process.env['NOTEBOOK_X']", () => {
    expect([...notebookEnvReads("const x = process.env['NOTEBOOK_FIXTURE_SINGLE'] === '1';")]).toEqual([
      "NOTEBOOK_FIXTURE_SINGLE",
    ]);
  });

  it("ignores flag examples in comments and string literals", () => {
    expect([...notebookEnvReads(`
      // process.env.NOTEBOOK_COMMENT
      const example = 'process.env["NOTEBOOK_STRING"]';
      const active = process.env.NOTEBOOK_REAL;
    `)]).toEqual(["NOTEBOOK_REAL"]);
  });

  it("recognizes bracket reads with legal intervening comments", () => {
    expect([...notebookEnvReads('process.env[ /* rollout */ "NOTEBOOK_COMMENTED_BRACKET" ];')])
      .toEqual(["NOTEBOOK_COMMENTED_BRACKET"]);
  });

  it.each([
    '  import { sneak } from "./sneaky-flag";',
    'import "@/lib/sneaky-flag";',
    'void import ("./sneaky-flag");',
    'import { sneak } from "./sneaky-flag.js";',
    'export*from"./sneaky-flag";',
    'const { sneak } = require("./sneaky-flag");',
    'import helper = require("./sneaky-flag");',
  ])("discovers an undeclared flag through legal module syntax: %s", (statement) => {
    const overlay = new Map<string, string>([
      ["lib/manual-rag.ts", statement],
      ["lib/sneaky-flag.ts", 'export const sneak = process.env["NOTEBOOK_SYNTAX_MUTATION"];'],
    ]);
    const undeclared = [...discoverNotebookReads(overlay)].filter((flag) => !declaredFlags().has(flag));
    expect(undeclared).toContain("NOTEBOOK_SYNTAX_MUTATION");
  });

  it("walks nested transitive imports and terminates cycles", () => {
    const overlay = new Map<string, string>([
      ["lib/manual-rag.ts", 'import "./fixture-only-nested/start";'],
      ["lib/fixture-only-nested/start.ts", 'export { sneak } from "./leaf.js";'],
      ["lib/fixture-only-nested/leaf.ts", `
        import "./start";
        export const sneak = process.env.NOTEBOOK_TRANSITIVE_MUTATION;
      `],
    ]);
    expect([...discoverNotebookReads(overlay)]).toContain("NOTEBOOK_TRANSITIVE_MUTATION");
  });

  it("parses TSX helpers using their real script kind", () => {
    const overlay = new Map<string, string>([
      ["lib/manual-rag.ts", 'import "./flag-view";'],
      ["lib/flag-view.tsx", 'export const view = <div>{process.env.NOTEBOOK_TSX_MUTATION}</div>;'],
    ]);
    expect([...discoverNotebookReads(overlay)]).toContain("NOTEBOOK_TSX_MUTATION");
  });

  it.each(WALK_ROOTS)("does not exempt a helper merely because it is under lib/llm: %s", (root) => {
    const overlay = new Map<string, string>([
      ["lib/manual-rag.ts", ""],
      [root, 'import "@/lib/llm/flag-fixture";'],
      ["lib/llm/flag-fixture.ts", 'export const flag = process.env.NOTEBOOK_CASCADE_MUTATION;'],
    ]);
    expect([...discoverNotebookReads(overlay)]).toContain("NOTEBOOK_CASCADE_MUTATION");
  });

  it.each([
    'import type { Sneak } from "./types-only";',
    'import { type Sneak } from "./types-only";',
    'export type { Sneak } from "./types-only";',
    'export { type Sneak } from "./types-only";',
    '// import "./types-only";',
  ])("does not walk erased or commented imports: %s", (statement) => {
    const overlay = new Map<string, string>([
      ["lib/manual-rag.ts", statement],
      ["lib/types-only.ts", 'export const sneak = process.env.NOTEBOOK_NOT_EXECUTED;'],
      ["lib/unreachable.ts", 'export const unused = process.env.NOTEBOOK_UNREACHABLE;'],
    ]);
    expect([...discoverNotebookReads(overlay)].filter((flag) => !declaredFlags().has(flag))).toEqual([]);
  });

  it("fails closed when a local production import cannot be resolved", () => {
    const overlay = new Map([["lib/manual-rag.ts", 'import "./fixture-does-not-exist";']]);
    expect(() => discoverNotebookReads(overlay)).toThrow("Unresolved production import");
  });

  it("does not accept FLAGS declarations or keys hidden in comments", () => {
    const source = `
      // const FLAGS: Record<string, unknown> = { NOTEBOOK_FAKE_OBJECT: {} };
      const FLAGS: Record<string, unknown> = {
        // NOTEBOOK_COMMENTED_KEY: {},
        "NOTEBOOK_REAL_KEY": {},
      };
    `;
    expect([...declaredFlags(source)]).toEqual(["NOTEBOOK_REAL_KEY"]);
    expect(() => declaredFlags('// const FLAGS = { NOTEBOOK_FAKE: {} };')).toThrow("FLAGS must be a static object literal");
  });

  it("every NOTEBOOK_* flag retrieveNodeChunks imports read is declared", () => {
    const read = discoverNotebookReads();
    const declared = declaredFlags();
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((f) => !declared.has(f)).sort(), "declare the new flag in FLAGS").toEqual([]);
  });

  it("mutation: a dotted read in a helper retrieveNodeChunks imports is undeclared", () => {
    const overlay = new Map<string, string>();
    overlay.set("lib/sneaky-flag.ts", 'export const sneak = process.env.NOTEBOOK_UNDECLARED_DOT === "1";\n');
    overlay.set(
      "lib/manual-rag.ts",
      `${readFileSync(SRC("lib/manual-rag.ts"), "utf8")}\nimport "./sneaky-flag";\n`,
    );
    const undeclared = [...discoverNotebookReads(overlay)].filter((f) => !declaredFlags().has(f));
    expect(undeclared).toContain("NOTEBOOK_UNDECLARED_DOT");
  });

  it("mutation: a bracket read in a helper retrieveNodeChunks imports is undeclared", () => {
    const overlay = new Map<string, string>();
    overlay.set("lib/sneaky-flag.ts", 'export const sneak = process.env["NOTEBOOK_UNDECLARED_BRACKET"] === "1";\n');
    overlay.set(
      "lib/manual-rag.ts",
      `${readFileSync(SRC("lib/manual-rag.ts"), "utf8")}\nimport "./sneaky-flag";\n`,
    );
    const undeclared = [...discoverNotebookReads(overlay)].filter((f) => !declaredFlags().has(f));
    expect(undeclared).toContain("NOTEBOOK_UNDECLARED_BRACKET");
  });
});
