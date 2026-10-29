#!/bin/bash
# Run the end-to-end safety driver against a BUILD UNDER TEST that is not this
# branch: a detached worktree at <base> with <merge-ref>... merged in, plus a
# copy of tests/safety-e2e/ (the harness is never part of the system under test).
# The worktree is removed on every exit path (trap), per
# .claude/rules/subagent-worktree-isolation.md pattern (a).
#
# Usage: tools/safety_e2e/run_build.sh <name> <base-ref> [merge-ref ...]
#   env: SAFETY_E2E_* as documented in mira-hub/tests/safety-e2e/run.e2e.ts,
#        SAFETY_E2E_NODE_MODULES (an existing mira-hub/node_modules with the same
#        package.json), SAFETY_E2E_WT_ROOT (scratch dir outside the repo).
set -euo pipefail

name=${1:?name}; base=${2:?base ref}; shift 2
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
wt_root=${SAFETY_E2E_WT_ROOT:?set SAFETY_E2E_WT_ROOT outside the repo}
nm=${SAFETY_E2E_NODE_MODULES:?set SAFETY_E2E_NODE_MODULES}
wt="$wt_root/safety-e2e-wt-$name"

cleanup() {
  rm -f "$wt/mira-hub/node_modules"
  git -C "$repo" worktree remove --force "$wt" 2>/dev/null || true
}
trap cleanup EXIT

git -C "$repo" worktree remove --force "$wt" 2>/dev/null || true
git -C "$repo" worktree add -q --detach "$wt" "$base"
for ref in "$@"; do
  git -C "$wt" -c user.email=safety-e2e@local -c user.name=safety-e2e \
    merge -q --no-edit --no-verify "$ref" >/dev/null
done
sha=$(git -C "$wt" rev-parse HEAD)
echo "build $name = $sha (base $base + $*)"
if ! cmp -s "$repo/mira-hub/package.json" "$wt/mira-hub/package.json"; then
  echo "refusing: package.json differs from the node_modules source" >&2
  exit 2
fi
mkdir -p "$wt/mira-hub/tests"
cp -R "$repo/mira-hub/tests/safety-e2e" "$wt/mira-hub/tests/"
ln -s "$nm" "$wt/mira-hub/node_modules"
(cd "$wt/mira-hub" && npx vitest run --config tests/safety-e2e/vitest.config.ts)
