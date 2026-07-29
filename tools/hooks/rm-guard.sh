#!/usr/bin/env bash
# tools/hooks/rm-guard.sh
# PreToolUse(Bash) hook — deterministic safety FLOOR for destructive `rm -rf`.
#
# Thin wrapper: extracts the submitted Bash command (same contract as
# prod-guard.sh / git-state-guard.sh — stdin PreToolUse JSON OR $CLAUDE_TOOL_INPUT)
# and delegates the analysis to tools/hooks/rm_guard.py, which resolves variables,
# normalizes paths, and follows symlinks so `rm -rf "$REPO"` / `rm -rf ..` /
# `rm -rf <symlink-to-repo>` all collapse to the same absolute path and get caught
# — cases a static `permissions.deny` glob cannot detect.
#
# This is the HARD FLOOR that complements (not replaces) the judgment-based
# doctrine in .claude/rules/dangerous-commands-safety.md. Scope is deliberately
# narrow (root / home / repo-root / .git) to keep false positives near zero.
#
# Override: MIRA_ALLOW_RM=1 (set per-shell when you consciously intend the delete).
#
# Emits PreToolUse permission JSON on stdout (deny) or nothing (allow), matching
# tools/hooks/prod-guard.sh.

set -uo pipefail

# Pull the bash command FIRST (this drains stdin) so every early-exit below is
# safe — exiting before reading stdin would SIGPIPE the caller writing the
# PreToolUse payload. Prefer stdin (canonical), fall back to env var.
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

# Operator override — silent allow (stdin already drained above).
if [ "${MIRA_ALLOW_RM:-0}" = "1" ]; then
  exit 0
fi

# Cheap reject: no `rm` anywhere → allow without spawning python.
case "$cmd" in
  *rm*) : ;;
  *) exit 0 ;;
esac

# Delegate to the analyzer. It prints deny JSON (and nothing on allow).
printf '%s' "$cmd" | python3 "$(dirname "$0")/rm_guard.py"
exit 0
