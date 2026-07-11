#!/usr/bin/env bash
# tools/hooks/git-state-guard.sh
# PreToolUse(Bash) hook — blocks git *mutators* (commit/rebase/merge/push/reset,
# stash drop) when the repo is in a wedged state: a paused/interrupted rebase
# (.git/rebase-merge or .git/rebase-apply present) or a detached HEAD.
#
# Rationale (insights report 2026-06-08, P0): the #1 recurring derailer is a
# cron `git pull --rebase --autostash` (or a hand-run rebase) that leaves the
# tree mid-rebase; a subsequent `git commit` then lands on the wrong base, drops
# the autostash, or detaches HEAD. This hook refuses the mutator and tells the
# operator to finish/abort the rebase first.
#
# Read-only git ops (status/log/diff/show/fetch/branch -l/...) pass through.
#
# Side effect: refreshes the session lock /tmp/mira-claude-active.lock on every
# Bash call (this hook fires on every Bash PreToolUse), so safe-cron-pull.sh
# sees an *active* session for the full session, not just its first 2h. This
# closes the long-session gap the SessionStart-only touch leaves open.
#
# Override: MIRA_ALLOW_GIT_WEDGE=1 (set per-shell when you're deliberately
# operating inside a rebase, e.g. scripting a `git rebase --continue` loop).
# NOTE: this only works when the env var is already set in the calling shell's
# environment BEFORE the hook fires — it does NOT help a single Bash tool call
# that does `export MIRA_ALLOW_GIT_WEDGE=1 && git rebase --continue`, because
# the hook evaluates the submitted command text before any of it has executed.
# The --continue/--abort/--skip/--quit exemption below is what actually makes
# a single-call `git rebase --continue` work while mid-rebase.
#
# Reads PreToolUse JSON from stdin OR $CLAUDE_TOOL_INPUT (legacy MIRA hooks).
# Emits PreToolUse permission JSON on stdout (matches tools/hooks/prod-guard.sh).

set -uo pipefail

# Refresh the session-active lock on every Bash call (cheap, best-effort).
touch /tmp/mira-claude-active.lock 2>/dev/null || true

# Operator override — silent allow.
if [ "${MIRA_ALLOW_GIT_WEDGE:-0}" = "1" ]; then
  exit 0
fi

# Pull the bash command. Prefer stdin (canonical), fall back to env var.
cmd=""
if [ ! -t 0 ]; then
  payload=$(cat 2>/dev/null || true)
  if [ -n "$payload" ]; then
    cmd=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("command", "") or "")
except Exception:
    print("")
' 2>/dev/null || true)
  fi
fi
[ -z "$cmd" ] && cmd="${CLAUDE_TOOL_INPUT:-}"
[ -z "$cmd" ] && exit 0  # Nothing to inspect; allow.

# Is this a git *mutator*? Match `git ... <verb>` and `git stash drop`/`pop`.
# Read-only verbs (status/log/diff/show/fetch/branch/rev-parse) are NOT matched.
MUTATOR='git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|rebase|merge|push|reset|cherry-pick|revert|am)([[:space:]]|$)|git[[:space:]]+stash[[:space:]]+(drop|pop|clear)'
if ! printf '%s' "$cmd" | grep -qE "$MUTATOR"; then
  exit 0  # Not a mutator; allow.
fi

# Resolve the git dir for whatever repo we're cwd'd into (not hardcoded).
GITDIR=$(git rev-parse --git-dir 2>/dev/null || true)
[ -z "$GITDIR" ] && exit 0  # Not in a git repo; nothing to guard.

# A mutator that's ITSELF the resolving action (--continue/--abort/--skip/
# --quit on rebase/cherry-pick/revert/am) must always be allowed through even
# while mid-rebase — otherwise there is no way to resolve the wedge from a
# single Bash tool call (see NOTE above).
RESOLVER='git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(rebase|cherry-pick|revert|am)([[:space:]]+-[^[:space:]]+)*[[:space:]]+--(continue|abort|skip|quit)([[:space:]]|$)'
if printf '%s' "$cmd" | grep -qE "$RESOLVER"; then
  exit 0  # Resolving a wedge, not creating one; allow.
fi

reason=""
if [ -d "${GITDIR}/rebase-merge" ] || [ -d "${GITDIR}/rebase-apply" ]; then
  reason="repository is mid-rebase (${GITDIR}/rebase-merge or rebase-apply exists). Finish it with 'git rebase --continue' or abandon it with 'git rebase --abort' before running git mutators."
elif ! git symbolic-ref -q HEAD >/dev/null 2>&1; then
  reason="HEAD is detached. Check out a branch ('git checkout <branch>') before running git mutators, or your commit will be orphaned."
fi

if [ -n "$reason" ]; then
  esc=$(printf '%s' "$reason" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${reason//\"/\\\"}")
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$esc"
  exit 0
fi

exit 0
