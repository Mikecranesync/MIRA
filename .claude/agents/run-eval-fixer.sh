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

# Pull latest code so the agent sees up-to-date scorecards and source
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
git pull --ff-only origin "$CURRENT_BRANCH" >> "$LOG" 2>&1 || {
  echo "git pull failed — proceeding with local state" >> "$LOG"
}

INSTRUCTIONS="$(cat "$INSTRUCTIONS_FILE")"

# Run claude non-interactively.
# --print       — stream output to stdout/stderr, then exit
# --allowedTools — grant tool access without interactive prompts
# --max-turns    — hard ceiling so a runaway agent can't loop forever
claude \
  --print \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --max-budget-usd 1.00 \
  -p "$INSTRUCTIONS" \
  >> "$LOG" 2>> "$ERR"

EXIT_CODE=$?
echo "=== eval-fixer finished $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$EXIT_CODE ===" >> "$LOG"
exit $EXIT_CODE
