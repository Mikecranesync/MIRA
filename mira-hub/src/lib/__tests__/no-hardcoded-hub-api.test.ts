import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * #4698 regression guard.
 *
 * Prod serves the Hub at root (NEXT_PUBLIC_API_BASE=""), but several client
 * components hard-coded `/hub/api/...` instead of the `API_BASE` export from
 * `@/lib/config` (`process.env.NEXT_PUBLIC_API_BASE ?? "/hub"`). On prod the
 * nginx `/hub/` → `/` rewrite is not live, so a literal `/hub/api/*` call
 * 307s to `/login` instead of reaching its API route — breaking the admin
 * Approve/Revoke/Expire buttons, work-order load/update, manual delete, asset
 * QR, and the MachineMemoryCard / AssetIntelligencePanel / open-in-cmms-button
 * fetches. Live probe, 2026-10-24:
 *   PATCH /hub/api/admin/users/x/ -> 307 /login
 *   PATCH /api/admin/users/x/     -> 401 (the real route)
 *
 * This guard fails if ANY runtime string/template literal under
 * `mira-hub/src` starts with `/hub/api`. It deliberately does not flag:
 *  - comments (`// ... /hub/api ...`, block comments)
 *  - the `hint:` message string in `app/api/uploads/route.ts`
 *  - `*.test.ts(x)` / `*.spec.ts(x)` / `__tests__/` fixtures (own test data,
 *    e.g. `wo-photo-upload.test.ts` exercising `workOrderPhotoUploadUrl("/hub")`)
 *
 * Detection is literal-anchored (a quote/backtick immediately followed by
 * `/hub/api`), not line-filtered on `fetch(`/`EventSource(` — a multi-line
 * call like `open-in-cmms-button.tsx` has `fetch(` on one line and the
 * offending literal on the next, which a same-line filter would miss.
 */

const SRC_ROOT = resolve(__dirname, "..", "..");

const HARDCODED_HUB_API = /["'`]\/hub\/api/;

function stripComments(source: string): string {
  // Block comments first (so a `//` inside one doesn't confuse the line pass).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments: strip from the start of a `//` to end of line. This is a
  // simplification (it would also eat a `//` inside a string), but none of
  // the fixtures below or the real source under test have a `//` inside a
  // string literal on a line that also contains a hub/api literal, so it's
  // safe here and keeps the detector simple.
  out = out
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
  return out;
}

function isTestFile(path: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(path) ||
    path.split("/").includes("__tests__")
  );
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Pure function: source text in, hit list out — unit-testable without disk I/O. */
function findHardcodedHubApi(source: string): Array<{ line: number; text: string }> {
  const stripped = stripComments(source);
  const hits: Array<{ line: number; text: string }> = [];
  stripped.split("\n").forEach((line, idx) => {
    if (HARDCODED_HUB_API.test(line)) {
      hits.push({ line: idx + 1, text: line.trim() });
    }
  });
  return hits;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("#4698 no-hardcoded-/hub/api guard — unit (pure function)", () => {
  it("flags a fetch() with a backtick template literal", () => {
    const hits = findHardcodedHubApi(
      "const res = await fetch(`/hub/api/admin/users/${id}/`, { method: 'PATCH' });",
    );
    expect(hits).toHaveLength(1);
  });

  it("flags a fetch() with a plain single-quoted string", () => {
    const hits = findHardcodedHubApi("fetch('/hub/api/x')");
    expect(hits).toHaveLength(1);
  });

  it("flags a multi-line fetch() call whose literal is on the second line", () => {
    const hits = findHardcodedHubApi(
      [
        "const res = await fetch(",
        "  `/hub/api/cmms/deep-link?kind=${kind}`,",
        ");",
      ].join("\n"),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it("does NOT flag a call already routed through API_BASE", () => {
    const hits = findHardcodedHubApi(
      "const res = await fetch(`${API_BASE}/api/admin/users/${id}/`);",
    );
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a line comment documenting the path", () => {
    const hits = findHardcodedHubApi("// POST /hub/api/namespace/node/[id]/chat");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a server-side hint message string", () => {
    const hits = findHardcodedHubApi(
      '      hint: "DELETE /hub/api/uploads/:id then re-upload",',
    );
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a block comment", () => {
    const hits = findHardcodedHubApi("/**\n * POST /hub/api/auth/openwebui\n */");
    expect(hits).toHaveLength(0);
  });
});

describe("#4698 no-hardcoded-/hub/api guard — full tree", () => {
  const allFiles = walk(SRC_ROOT);

  it("actually scanned the real source tree (sanity: hundreds of files, includes lib/config.ts)", () => {
    expect(allFiles.length).toBeGreaterThan(200);
    expect(allFiles.some((f) => f.endsWith(join("lib", "config.ts")))).toBe(true);
  });

  it("no non-test client file under mira-hub/src hard-codes a /hub/api literal", () => {
    const hits: Hit[] = [];
    for (const file of allFiles) {
      if (isTestFile(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const hit of findHardcodedHubApi(source)) {
        hits.push({ file: file.replace(SRC_ROOT + "/", "src/"), ...hit });
      }
    }
    const report = hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(hits, `Hard-coded /hub/api literal(s) found:\n${report}`).toEqual([]);
  });
});
