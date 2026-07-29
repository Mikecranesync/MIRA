# E7 — Drop stale `mira-hub/package-lock.json` (3-cycle-stalled top action)

**Lens:** E (promotion pipeline) · **Staged:** 2026-06-14 · **Audited:** origin/main@fa9bfde7
**Severity:** low (CI-inert; local-dev footgun) · **Stranger-reachable:** NO · **Stall:** E5 top action → E6 → E7 (moved 0)

## Problem
`mira-hub/` carries BOTH `bun.lock` and `package-lock.json` on origin/main. The lockfile of
record is `bun.lock`: the deploy gate (`smoke-test.yml:60`) and the staging/enforcement jobs
install via `bun install --frozen-lockfile --ignore-scripts` after the #1855 fix. The
`package-lock.json` is npm-shaped and never refreshed, so it is missing the `graphology`/`unpdf`
deps (the #1855 drift episode). It is CI-inert (no job runs `npm ci` anymore) but a developer who
runs `npm ci` locally in `mira-hub/` re-hits the exact drift hard-fail #1855 fixed.

## Fix (founder/maintainer — one command)
```bash
cd "$(git rev-parse --show-toplevel)"
git rm mira-hub/package-lock.json
git commit -m "chore(hub): drop stale package-lock.json; bun.lock is the lockfile of record (#1855 follow-up)"
```

## Verify
```bash
# bun.lock remains, package-lock gone:
git ls-tree --name-only HEAD mira-hub/ | grep -E 'bun.lock|package-lock.json'   # expect ONLY bun.lock
# install still resolves via bun (what CI does):
cd mira-hub && bun install --frozen-lockfile --ignore-scripts && echo OK
# no workflow references package-lock:
rg -n 'package-lock' .github/workflows/ || echo "no CI references — safe"
```

## Why this is safe
- No `.github/workflows/*` job invokes `npm ci` against `mira-hub/` (all switched to bun, #1855).
- `bun.lock` is committed and in sync with `package.json` (graphology ^0.26.0 + unpdf ^1.6.2).
- Pure deletion of an unreferenced, drifted artifact; reversible via `git revert`.

Orchestrator note: staged as instructions (not a binary delete-diff) to keep the patch small;
the `git rm` is the canonical form. Not applied in place — audits are read-only on code.
