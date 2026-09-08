import { realpathSync } from "node:fs";

// `@factorylm/ui` declares React as a peer but carries a package-local copy so
// its own suites can run from the package directory. Bun resolves `react` from
// a file's PHYSICAL path, so when that copy is a real directory rather than the
// symlink `bootstrap:ui` installs, the lab's renderer and the package's hooks
// load two different module instances and every hook throws "Invalid hook call".
//
// That condition is emergent: it depends on install state, so two checkouts of
// the same commit disagree about whether the suite passes (#3692). Measured:
//
//   packages/factorylm-ui/node_modules/react is the bootstrap symlink
//     -> 164 pass / 0 fail
//   packages/factorylm-ui/node_modules/react is a real directory
//     -> 159 pass / 5 fail, five "Invalid hook call"
//
// This makes the precondition checkable rather than emergent — one resolved
// realpath, asserted by name, instead of a hook error five frames from its cause.

/** Modules that must resolve to a single instance; `bootstrap:ui` links each one. */
const SHARED_MODULES = ["react", "react-dom"] as const;

type Resolution = { path: string } | { error: string };

function resolveFrom(dir: string, specifier: string): Resolution {
  try {
    return { path: realpathSync(Bun.resolveSync(specifier, dir)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Returns an actionable message when the lab and `@factorylm/ui` would load
 * different copies of a shared module, or `null` when every one agrees.
 *
 * A module that fails to resolve from the package is reported too: it has the
 * same cause (the package's dependencies were never installed) and the same
 * cure, and it otherwise surfaces as `Cannot find package 'react'`.
 */
export function findReactDuplication(labDir: string, packageDir: string): string | null {
  const problems: string[] = [];

  for (const specifier of SHARED_MODULES) {
    const lab = resolveFrom(labDir, specifier);
    const pkg = resolveFrom(packageDir, specifier);

    if ("error" in lab) {
      problems.push(`  ${specifier}: not resolvable from the lab — ${lab.error}`);
      continue;
    }
    if ("error" in pkg) {
      problems.push(`  ${specifier}: not resolvable from @factorylm/ui — ${pkg.error}`);
      continue;
    }
    if (lab.path !== pkg.path) {
      problems.push(
        `  ${specifier}: two instances\n` +
          `      lab           ${lab.path}\n` +
          `      @factorylm/ui ${pkg.path}`,
      );
    }
  }

  if (problems.length === 0) return null;

  return [
    "The lab and @factorylm/ui do not share one React instance:",
    ...problems,
    "",
    "Every hook in a component from @factorylm/ui will throw \"Invalid hook call\".",
    "Run `bun run bootstrap:ui` first — it symlinks the package's copies at the",
    "lab's so both resolve to one instance. The declared `bun run test` does this",
    "for you; a bare `bun test` does not. See issue #3692.",
  ].join("\n");
}
