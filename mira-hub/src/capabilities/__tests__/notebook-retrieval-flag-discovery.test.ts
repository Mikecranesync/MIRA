/**
 * Flag discovery (#5167): undeclared NOTEBOOK_* reads on the retrieveNodeChunks
 * import graph must fail the guard, including process.env["NOTEBOOK_X"].
 *
 * Declared names stay in notebook-retrieval-flag-guard.test.ts (FLAGS). This
 * file walks production imports instead of a hand-kept source list.
 *
 * Run: bunx vitest run src/capabilities/__tests__/notebook-retrieval-flag-discovery.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

/**
 * Production roots whose NOTEBOOK_* reads change retrieveNodeChunks. The walker
 * follows their transitive @/ and relative imports so a new helper cannot hide
 * an undeclared flag. query-rewrite.ts is a second root because the chat route
 * feeds rewrittenQuery into retrieveNodeChunks; its LLM cascade is not a
 * retrieval flag source and is not followed.
 */
const WALK_ROOTS = ["lib/manual-rag.ts", "capabilities/query-rewrite.ts"];

/** Dotted `process.env.NOTEBOOK_X` and bracket `process.env["NOTEBOOK_X"]`. */
const ENV_READ =
  /process\.env(?:\.(NOTEBOOK_[A-Z0-9_]+)|\[\s*['"](NOTEBOOK_[A-Z0-9_]+)['"]\s*\])/g;

function notebookEnvReads(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(ENV_READ)) out.add((m[1] ?? m[2]) as string);
  return out;
}

function importedSpecs(source: string): string[] {
  const specs: string[] = [];
  const fromRe =
    /(?:^|\n)(?:import|export)\s+(?!type\s)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;
  const starRe = /(?:^|\n)export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  const sideRe = /(?:^|\n)import\s+['"]([^'"]+)['"]/g;
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [fromRe, starRe, sideRe, dynRe]) {
    for (const m of source.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

function resolveSpec(fromRel: string, spec: string, overlay: Map<string, string>): string | null {
  if (spec.startsWith("node:") || spec.endsWith(".json") || spec.startsWith("@factorylm/")) return null;
  if (spec.startsWith("@/lib/llm")) return null;
  let rel: string;
  if (spec.startsWith("@/")) rel = spec.slice(2);
  else if (spec.startsWith(".")) rel = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  else return null;
  const candidates = /\.(ts|tsx|js|mjs)$/.test(rel)
    ? [rel]
    : [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`];
  for (const c of candidates) {
    const norm = c.replace(/\\/g, "/");
    if (norm.includes("/__tests__/") || /\.test\.tsx?$/.test(norm)) continue;
    if (overlay.has(norm) || existsSync(SRC(norm))) return norm;
  }
  return null;
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
    for (const f of notebookEnvReads(source)) reads.add(f);
    for (const spec of importedSpecs(source)) {
      const next = resolveSpec(rel, spec, overlay);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return reads;
}

/** FLAGS keys in the behavioral guard are the declared-name source of truth. */
function declaredFlags(): Set<string> {
  const src = readFileSync(SRC("lib/__tests__/notebook-retrieval-flag-guard.test.ts"), "utf8");
  const start = src.indexOf("const FLAGS:");
  expect(start, "FLAGS missing from notebook-retrieval-flag-guard.test.ts").toBeGreaterThanOrEqual(0);
  const end = src.indexOf("const KNOWN_BYPASS:");
  const block = src.slice(start, end === -1 ? undefined : end);
  const names = [...block.matchAll(/^\s+(NOTEBOOK_[A-Z0-9_]+):/gm)].map((m) => m[1]);
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
