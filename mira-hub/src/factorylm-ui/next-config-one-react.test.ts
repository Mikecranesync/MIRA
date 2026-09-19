/**
 * One-React invariant for the /v3 shared-shell mount (#3839 follow-up, review M1).
 *
 * The shell sources in ../packages/factorylm-* compile with the repo root as the
 * Turbopack root, so a bare `import "react"` from there walks UP and would find a
 * hoisted second React in <repo>/node_modules (the ui-lab workspace). The guarantee
 * that it never does is `turbopack.resolveAlias` in next.config.ts pinning the five
 * bare specifiers the shell imports to THIS app's node_modules copies.
 *
 * This test asserts every one of those aliases is present and resolves to a path under
 * mira-hub/node_modules. It is a config-shape test, not a build test — the build
 * (`next build`) proves the aliases don't break resolution; this proves they exist.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig, { ONE_REACT_ALIASES } from "../../next.config";

const HUB_ROOT = path.resolve(__dirname, "..", "..");
const HUB_NODE_MODULES = path.join(HUB_ROOT, "node_modules");

const REQUIRED_SPECIFIERS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "@assistant-ui/react",
] as const;

describe("next.config.ts one-React alias (shared shell at /v3)", () => {
  it("wires ONE_REACT_ALIASES into turbopack.resolveAlias", () => {
    expect(nextConfig.turbopack?.resolveAlias).toBe(ONE_REACT_ALIASES);
  });

  it("keeps the compiler root at the repo root so ../packages still compiles", () => {
    // Precondition for the whole problem: if the root ever moves back to mira-hub the
    // alias is moot (and ../packages stops resolving) — pin it so a drift is loud.
    expect(nextConfig.turbopack?.root).toBe(path.resolve(HUB_ROOT, ".."));
  });

  it.each(REQUIRED_SPECIFIERS)("pins %s to a path under mira-hub/node_modules", (specifier) => {
    const target = ONE_REACT_ALIASES[specifier];
    expect(target, `alias for ${specifier} is missing`).toBeTypeOf("string");
    // Turbopack resolves alias targets relative to the Next app dir and rejects absolute
    // paths outright ("server relative imports are not implemented yet" — breaks the
    // build), so the value must be app-relative, and explicitly so (leading "./"): a bare
    // "node_modules/react" would be read as a package request, not a path.
    expect(path.isAbsolute(target)).toBe(false);
    expect(target.startsWith("./")).toBe(true);
    // Resolved against the app dir it must land under mira-hub/node_modules — not
    // <repo>/node_modules (the hoisted ui-lab React) or anywhere else.
    const resolved = path.resolve(HUB_ROOT, target);
    expect(path.relative(HUB_NODE_MODULES, resolved).startsWith("..")).toBe(false);
    expect(resolved).toBe(path.join(HUB_NODE_MODULES, specifier));
  });

  it("pins exactly the five specifiers (no strays, no drift)", () => {
    expect(Object.keys(ONE_REACT_ALIASES).sort()).toEqual([...REQUIRED_SPECIFIERS].sort());
  });

  it("each aliased package directory exists in this app's node_modules", () => {
    // Control: the alias target must be a real install, otherwise the build would fail
    // to resolve it. Package DIRECTORIES are checked (subpath entries like
    // react/jsx-runtime resolve through package.json exports, not the filesystem).
    for (const pkg of ["react", "react-dom", "@assistant-ui/react"]) {
      expect(existsSync(path.join(HUB_NODE_MODULES, pkg, "package.json")), pkg).toBe(true);
    }
  });
});
