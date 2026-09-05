#!/usr/bin/env bash
# run-eval-fixer.sh — wrapper invoked by launchd at 05:00 UTC
# Reads eval-fixer-instructions.md and hands it to claude CLI as a non-interactive agent task.

set -euo pipefail

REPO="/Users/charlienode/MIRA"
INSTRUCTIONS_FILE="$REPO/.claude/agents/eval-fixer-instructions.md"
LOG_DIR="/tmp"
LOG="$LOG_DIR/mira-eval-fixer.log"
ERR="$LOG_DIR/mira-eval-fixer.err"

export PATH="/Users/charlienode/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

echo "=== eval-fixer started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$LOG"

cd "$REPO"

# Pull latest code so the agent sees up-to-date scorecards and source.
# MIRA is a SHARED working tree — whatever branch happens to be checked out when
# this fires (an interactive session's unpushed WIP branch, most nights) is not
# safe to `git pull` against (fails with "couldn't find remote ref", or worse,
# could clobber uncommitted work). Reuse the same safe-pull discipline as the
# cron jobs (tools/hooks/safe-cron-pull.sh): only pulls main, and only when the
# tree is clean/idle/on main — otherwise it no-ops and logs why.
MIRA_REPO="$REPO" "$REPO/tools/hooks/safe-cron-pull.sh" origin main -q >> "$LOG" 2>&1 || {
  echo "safe-cron-pull failed — proceeding with local state" >> "$LOG"
}

# Canary: a run's output stranded on local `main`. `main` is protected, so a commit made
# there can never be pushed — it sits until a human notices. That happened four times
# (#3134 rescued 3 nights, #3255 5 nights, #3473 10 nights, #3574 1 night) before the
# publish step below existed. If this fires, the publish path has regressed.
STRANDED="$(git -C "$REPO" log --oneline origin/main..main -- wiki/hot.d/ 2>/dev/null | wc -l | tr -d ' ')"
if [ "${STRANDED:-0}" -gt 0 ]; then
  echo "ERROR: $STRANDED eval-fixer fragment commit(s) stranded on local main (unpushable — main is protected)." >> "$LOG"
  git -C "$REPO" log --oneline origin/main..main -- wiki/hot.d/ >> "$LOG" 2>&1
fi

INSTRUCTIONS="$(cat "$INSTRUCTIONS_FILE")"

# Run claude non-interactively.
# --print       — stream output to stdout/stderr, then exit
# --allowedTools — grant tool access without interactive prompts
# --max-budget-usd — hard ceiling so a runaway agent can't loop forever.
#   Was 1.00, which silently failed every night 2026-07-06..09 ("Exceeded USD
#   budget (1)") before the agent could even finish reading the failure report
#   — the full workflow (baseline eval pass + patch + a SECOND eval pass, each
#   running the whole fixture suite through live LLM inference) costs well past
#   $1. Bumped to 10.00 based on an observed partial run using ~$0.87 on just
#   report-reading + exploration, no eval runs yet. Re-tune from real
#   /tmp/mira-eval-fixer.log spend data once a few nights complete successfully.
# `set -e` would abort here on a non-zero claude exit, skipping both the publish step and
# the "finished" log line. Take the exit code explicitly instead — the run's fragment must
# still be published even if the agent itself ended badly.
set +e
claude \
  --print \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --max-budget-usd 10.00 \
  -p "$INSTRUCTIONS" \
  >> "$LOG" 2>> "$ERR"
EXIT_CODE=$?
set -e

# Publish the fragment. This is deterministic code, not an instruction, because the prose
# telling the agent "never push to main directly — always use a branch + PR" was already
# in the instructions through all four stranding incidents above and was ignored every
# time. The helper builds the commit with plumbing and pushes the ref: it never checks
# out, so it is safe to run against this shared working tree while a session is live.
python3 "$REPO/tools/eval_fixer_fragment.py" \
  --date "$(date +%Y-%m-%d)" --publish --repo "$REPO" >> "$LOG" 2>&1 \
  || echo "publish step failed — the fragment may be unpushed; see above" >> "$LOG"

echo "=== eval-fixer finished $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$EXIT_CODE ===" >> "$LOG"
exit $EXIT_CODE
