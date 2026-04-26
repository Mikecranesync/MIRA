#!/usr/bin/env bash
# Install an hourly `git pull --rebase --autostash` for the MIRA repo on
# this node. Catches wiki updates from other cluster nodes (ALPHA's
# obsidian-git pushes, CHARLIE's eval-fixer commits) without manual pulls.
# Idempotent — refuses to add a duplicate entry.
#
# Uninstall: crontab -l | grep -v '# mira-wiki-pull' | crontab -

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="# mira-wiki-pull"
LOG="$HOME/Library/Logs/mira-wiki-pull.log"
GIT_BIN="$(command -v git)"

if [[ -z "$GIT_BIN" ]]; then
  echo "ERROR: git not on PATH" >&2
  exit 2
fi

mkdir -p "$(dirname "$LOG")"

ENTRY="0 * * * * cd $REPO_ROOT && $GIT_BIN pull --rebase --autostash >> $LOG 2>&1 $MARKER"

EXISTING="$(crontab -l 2>/dev/null || true)"

if grep -Fq "$MARKER" <<<"$EXISTING"; then
  CURRENT="$(grep -F "$MARKER" <<<"$EXISTING")"
  if [[ "$CURRENT" == "$ENTRY" ]]; then
    echo "cron entry already installed (unchanged)"
    exit 0
  fi
  echo "updating existing cron entry"
  printf '%s\n' "$EXISTING" | grep -vF "$MARKER" > /tmp/mira-cron.$$
  printf '%s\n' "$ENTRY" >> /tmp/mira-cron.$$
  crontab /tmp/mira-cron.$$
  rm -f /tmp/mira-cron.$$
else
  echo "installing cron entry"
  { [[ -n "$EXISTING" ]] && printf '%s\n' "$EXISTING"; printf '%s\n' "$ENTRY"; } | crontab -
fi

echo "Installed: $ENTRY"
echo "Verify with: crontab -l | grep mira-wiki-pull"
echo "Tail with:   tail -f $LOG"
