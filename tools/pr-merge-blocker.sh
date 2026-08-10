#!/usr/bin/env bash
# tools/pr-merge-blocker.sh
# Resolve a PR's merge state to a NAMED blocker — or report the status was stale.
#
# `gh pr view --json mergeStateStatus` returns BLOCKED as a catch-all AND lags the
# real state, so a bare "BLOCKED" is a prompt to go look, never a finding. See
# issue #3109 and the module docstring in pr_merge_blocker.py for the full why.
#
# Thin wrapper (same shape as tools/hooks/rm-guard.sh): the classification lives
# in Python so it can be unit-tested against fixtures with no network — see
# tests/test_pr_merge_blocker.py.
#
#   tools/pr-merge-blocker.sh <pr-number>
#
# Exit: 0 = nothing blocking, 1 = a real named blocker, 2 = UNKNOWN (never
# assume clean).

set -uo pipefail

exec python3 "$(dirname "$0")/pr_merge_blocker.py" "$@"
