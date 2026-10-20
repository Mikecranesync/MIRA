/**
 * A literal `process.cwd()` inside a file path makes Next's file tracer copy
 * everything that path could reach into `.next/standalone`. `review-queue.ts`
 * resolved the repo root this way, and 26 routes imported it (through
 * lib/capabilities.ts and providers/access-control.ts), so every local Hub
 * build carried about 10,000 repo files. That was 713 MB, including
 * mira-bridge's 255 MB SQLite DB that the `**\/*.db*` exclude never matched
 * (excludes resolve from mira-hub/). Use `process.env.PWD`, which is the same
 * value at runtime and invisible to the tracer.
 *
 * Run: npx vitest run src/capabilities/__tests__/no-cwd-file-paths.test.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function runtimeSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      runtimeSources(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// A path built from process.cwd(), in either argument order.
const CWD_PATH = /path\.(join|resolve)\([^)]*process\.cwd\(\)/;

describe("no runtime file path is built from process.cwd()", () => {
  it("scans a real source tree (precondition)", () => {
    expect(runtimeSources(SRC).length).toBeGreaterThan(100);
  });

  it("no non-test file under src/ joins or resolves a path from process.cwd()", () => {
    const offenders = runtimeSources(SRC)
      .filter((f) => CWD_PATH.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the detector catches the pattern it guards against (control)", () => {
    expect(CWD_PATH.test('return path.resolve(process.cwd(), "..");')).toBe(true);
    expect(CWD_PATH.test('path.join(process.cwd(), "..", "mira-bots")')).toBe(true);
    expect(CWD_PATH.test('return path.resolve(process.env.PWD ?? "", "..");')).toBe(false);
  });
});
