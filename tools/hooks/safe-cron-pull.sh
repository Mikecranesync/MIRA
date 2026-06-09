#!/usr/bin/env bash
# tools/hooks/safe-cron-pull.sh
# Wrapper the cron `git pull` jobs call INSTEAD of raw `git pull`. Preserves the
# "keep main fresh while idle" intent without ever touching an active session.
#
# Aborts the pull (exit 0, logs a reason) if ANY of:
#   - a rebase is in progress  (.git/rebase-merge or .git/rebase-apply)
#   - the tree is dirty        (git status --porcelain non-empty = active work)
#   - a session is active      (/tmp/mira-claude-active.lock mtime < 2h)
#   - the branch is not `main` (never pull into a feature branch)
# Otherwise it runs the pull.
#
# Always exits 0 so a downstream `&& pytest ...` in the cron line still runs
# against whatever is currently checked out.
#
# Usage (from cron):
#   cd /Users/bravonode/Mira && tools/hooks/safe-cron-pull.sh            # default: pull --rebase --autostash
#   cd /Users/bravonode/Mira && tools/hooks/safe-cron-pull.sh origin main -q   # explicit pull args
#
# Env:
#   MIRA_REPO          repo dir (default /Users/bravonode/Mira)
#   MIRA_LOCK_MAX_AGE  lock-freshness window in seconds (default 7200 = 2h)

set -uo pipefail

# cron runs a minimal PATH — guarantee Homebrew git/python are reachable.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
GIT="$(command -v git || echo /opt/homebrew/bin/git)"

REPO_DIR="${MIRA_REPO:-/Users/bravonode/Mira}"
LOCK="/tmp/mira-claude-active.lock"
LOCK_MAX_AGE="${MIRA_LOCK_MAX_AGE:-7200}"

ts() { date -u +%FT%TZ; }
skip() { echo "$(ts) safe-cron-pull: SKIP — $1"; exit 0; }

cd "$REPO_DIR" 2>/dev/null || { echo "$(ts) safe-cron-pull: SKIP — cannot cd to $REPO_DIR"; exit 0; }

GITDIR="$("$GIT" rev-parse --git-dir 2>/dev/null || echo .git)"

# 1. Rebase in progress?
if [ -d "${GITDIR}/rebase-merge" ] || [ -d "${GITDIR}/rebase-apply" ]; then
  skip "rebase in progress (${GITDIR}/rebase-merge|rebase-apply)"
fi

# 2. Dirty tree = active work?
if [ -n "$("$GIT" status --porcelain 2>/dev/null)" ]; then
  skip "working tree is dirty (uncommitted changes present)"
fi

# 3. Active session lock < LOCK_MAX_AGE old?
if [ -f "$LOCK" ]; then
  now=$(date +%s)
  # BSD stat (macOS) uses -f %m; GNU stat uses -c %Y.
  mtime=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0)
  age=$(( now - mtime ))
  if [ "$age" -lt "$LOCK_MAX_AGE" ]; then
    skip "active Claude session (lock ${age}s old < ${LOCK_MAX_AGE}s)"
  fi
fi

# 4. On a non-main branch?
branch="$("$GIT" symbolic-ref --short -q HEAD 2>/dev/null || echo DETACHED)"
if [ "$branch" != "main" ]; then
  skip "current branch is '$branch', not main"
fi

# All clear — do the pull.
if [ "$#" -gt 0 ]; then
  echo "$(ts) safe-cron-pull: pulling (git pull $*)"
  "$GIT" pull "$@"
else
  echo "$(ts) safe-cron-pull: pulling (git pull --rebase --autostash)"
  "$GIT" pull --rebase --autostash
fi
exit 0
