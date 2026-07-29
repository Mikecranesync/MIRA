#!/usr/bin/env bash
# MIRA beta-readiness orchestrator — FRESHNESS GUARD
#
# WHY THIS EXISTS
#   The orchestrator audits the *checked-out working tree*. If that tree is a
#   stale feature branch, the audit reports already-merged fixes as OPEN
#   blockers — a false RED. (2026-06-09: a run on feat/orchestrator-kg-query,
#   51 commits behind origin/main, flagged all 6 beta blockers as open; every
#   one had already merged via PR #1837 + #1845.)
#
#   Beta-readiness must be judged against what a beta tester actually runs =
#   production = origin/main HEAD (deploy-vps.yml checks out main). NOT the
#   feature branch a code session happens to be sitting on.
#
# WHAT IT DOES
#   1. git fetch origin (quiet).
#   2. Reports how far the working tree is behind origin/main.
#   3. For each path the current lens will audit, flags drift vs origin/main
#      and tells the orchestrator to read `git show origin/main:<path>` —
#      the deploy truth — instead of the working tree.
#
# USAGE
#   bash wiki/orchestrator/freshness-guard.sh [audited_path ...]
#
# EXIT CODES
#   0  working tree matches origin/main on the given paths — audit the tree
#   3  STALE — audit origin/main (read `git show origin/main:<path>`), and
#      record the staleness delta in BETA_READINESS.md
#   2  not a git repo / fatal
set -uo pipefail

DEPLOY_REF="${DEPLOY_REF:-origin/main}"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "FATAL: not a git repo"; exit 2; }
cd "$root" || exit 2

if ! git fetch origin --quiet 2>/dev/null; then
  echo "WARN: 'git fetch origin' failed — freshness unknown; treat results as possibly stale."
fi

behind="$(git rev-list --count "HEAD..${DEPLOY_REF}" 2>/dev/null || echo '?')"
ahead="$(git rev-list --count "${DEPLOY_REF}..HEAD" 2>/dev/null || echo '?')"
branch="$(git branch --show-current 2>/dev/null || echo DETACHED)"
echo "freshness: branch=${branch}  behind ${DEPLOY_REF} by ${behind}  ahead by ${ahead}"

stale=0
if [ "${behind}" != "0" ] && [ "${behind}" != "?" ]; then
  echo "WARN: working tree is ${behind} commit(s) behind ${DEPLOY_REF}."
  echo "      Beta-readiness == production == ${DEPLOY_REF}. Audit ${DEPLOY_REF}, not the working tree."
  stale=1
fi

for p in "$@"; do
  if ! git cat-file -e "${DEPLOY_REF}:${p}" 2>/dev/null; then
    echo "  ? ${p}: absent on ${DEPLOY_REF} (new/renamed/path differs) — verify before auditing"
    continue
  fi
  if git diff --quiet "${DEPLOY_REF}" -- "${p}" 2>/dev/null; then
    echo "  = ${p}: matches ${DEPLOY_REF}"
  else
    echo "  ! ${p}: DIFFERS from ${DEPLOY_REF} — audit 'git show ${DEPLOY_REF}:${p}' (deploy truth), not the tree"
    stale=1
  fi
done

if [ "${stale}" -eq 1 ]; then
  echo "RESULT: STALE → audit ${DEPLOY_REF}; note the delta in BETA_READINESS.md."
  exit 3
fi
echo "RESULT: current with ${DEPLOY_REF} — auditing the working tree is safe."
exit 0
