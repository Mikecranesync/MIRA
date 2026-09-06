# Task 4 report — shared FactoryLM shell

## Scope delivered

- Added one `FactoryLMShell` structure for public, web, mobile, and Hub profiles: navigation aside, main content region, persistent header, and capability-gated Inspector aside.
- Added reducer-backed project, nested-folder, and in-scope machine navigation. The shared UI package does not import scenario fixtures.
- Kept the conversation region deliberately inert for Task 5. No composer or `Ask MIRA` text box is rendered. `New chat` is visibly disabled because the current reducer has no approved new-thread action.
- Added responsive CSS that keeps the same component tree and presents navigation as a mobile drawer and Inspector as a bottom sheet.
- Added the native Bun/happy-dom test harness and the Task 4 shell tests.

## TDD evidence

RED (before the shell existed):

```text
bun test ../../packages/factorylm-ui/src/__tests__/shell.test.tsx
error: Cannot find module 'react/jsx-runtime' from .../packages/factorylm-ui/src/__tests__/harness.tsx
0 pass, 1 fail, 1 error
```

The test was intentionally written first. The initial failure established that the new UI package had neither the shell implementation nor a package-local React test toolchain.

GREEN:

```text
6 pass, 0 fail, 34 expect() calls
```

The focused suite verifies canonical landmarks on all four profiles, disabled `New chat`, the inert Task 5 placeholder, reducer-backed project/folder/machine selection, and Hub-only Inspector availability.

## Toolchain and license-audit divergence

Bun 1.4 resolves TSX peer imports from the physical package path rather than the consuming lab path. To keep React and React DOM as peers while making the requested native command executable, `@factorylm/ui` now has a conventional pinned package-local development toolchain and `packages/factorylm-ui/bun.lock`.

The license audit now resolves a linked package by its real `package.json` path. This follows the package-local dependency closure rather than the incomplete Bun mirror under the lab's `node_modules`; the final audit covered 26 external package manifests, all MIT or Apache-2.0.

## Fix Round 1 — reproducibility and mobile navigation

- `bootstrap:ui` is checked in and runs `bun install --frozen-lockfile --ignore-scripts` in the UI package before every runtime test and license audit. Every nested lab script uses `$npm_execpath`, while the bootstrap subprocess uses `process.execPath`, so the invoking Bun executable—not `PATH`—is retained. Both manifests pin `packageManager: bun@1.4.0`.
- Focused tests were written before the controls existed. RED was `7 pass, 2 fail`: both failures reported that the required mobile navigation controls were absent. GREEN is `9 pass, 0 fail, 44 expectations` after adding the reducer-backed Open/Close controls and close-on-project/folder/machine selection.
- The duplicate Drive A test now finds `machine-drive-a` only below the selected Brake folder's `<li>` subtree. Removing that nested link makes the test fail before selection.
- CSS contract coverage protects the fixed/translated mobile drawer and fixed bottom-sheet Inspector foundation. Task 6 remains responsible for scrim, focus trap, Escape/hardware Back, and final overlay accessibility.

## Verification

Run from `apps/factorylm-ui-lab`:

```text
bun install --frozen-lockfile                                     # exit 0
bun run test:shell                                                # 9 pass, 44 expectations
bun run test                                                      # 41 pass, 573 expectations
bunx tsc --noEmit                                                  # exit 0
bun run licenses                                                   # 26 external manifests, all MIT/Apache-2.0
bun run verify                                                     # exit 0
git diff --check                                                   # exit 0
```

Clean-state proof: after moving only the generated `packages/factorylm-ui/node_modules` directory to Trash, `/opt/homebrew/bin/bun install --frozen-lockfile` followed by `PATH="/Users/charlienode/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin" /opt/homebrew/bin/bun run test:shell` recreated only the package-local eight-package closure and passed all 9 focused tests. No repository archive was created. This same PATH adversarial check had Bun 1.3.10 first but printed `bun install v1.4.0` and `bun test v1.4.0`, proving all nested scripts keep the invoking executable.

## Contract verification

CodeGraph is not initialized in this worktree. Direct source checks confirmed every imported interaction symbol and signature: `PlatformAdapter`, `ShellState`, `ShellAction`, `Project`, `ProjectNode`, `SurfaceKind`, `FixtureId`, `PROFILES`, `createShellState`, `getFixture`, and `shellReducer`.

No `packages/factorylm-theme` file was modified or staged.
