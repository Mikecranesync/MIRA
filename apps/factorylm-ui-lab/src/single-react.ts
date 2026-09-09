import { realpathSync } from "node:fs";

// `@factorylm/ui` declares React only as a peer; the lab supplies it, and both are
// members of one Bun workspace with the isolated linker pinned (#3705), so the peer
// React linked into the package and the lab's React are the same store directory.
// Bun resolves `react` from a file's PHYSICAL path, so if that ever stops being
// true — a tree installed outside the workspace, or the package re-declaring its
// own React — the lab's renderer and the package's hooks load two module instances
// and every hook throws "Invalid hook call".
//
// That failure was once emergent, varying by install state so that two checkouts
// of one commit disagreed (#3692). Measured before the workspace fix:
//
//   one React (deduped)                 -> 164 pass / 0 fail
//   packages/factorylm-ui with its own  -> 159 pass / 5 fail, five "Invalid hook call"
//
// The workspace makes one React the only possible outcome; this guard is the
// assertion that it still holds — one resolved realpath, checked by name, instead
// of a hook error five frames from its cause.

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
    "The lab and @factorylm/ui are members of one Bun workspace and share a single",
    "React by construction (#3705). Two instances mean the tree was installed outside",
    "the workspace, or the package re-declared its own React. Reinstall from the",
    "repository root: `bun install`. See issue #3692.",
  ].join("\n");
}
