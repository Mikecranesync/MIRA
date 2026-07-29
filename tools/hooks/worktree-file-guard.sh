#!/usr/bin/env bash
# tools/hooks/worktree-file-guard.sh
# Warn (never block) if a Write|Edit lands in a different git checkout/worktree than
# the current shell. Prevents subagent/session files being written to the wrong place.
# Uses $CLAUDE_TOOL_INPUT (JSON) passed by the PreToolUse hook, matcher Write|Edit.

set -uo pipefail

# Extract file_path from JSON tool input. Mirrors the pattern in gitleaks-on-commit
# hook (grep on raw string). For robustness, fallback to parsing if grep fails.
FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -oP '"file_path":\s*"\K[^"]+' || true)
if [ -z "$FILE_PATH" ]; then
  # Fallback: try Python JSON parsing (repo already uses one-liners in stop-gate.sh)
  FILE_PATH=$(python3 -c "import json,sys,os; d=json.loads(sys.stdin.read() or '{}'); print(d.get('file_path',''))" <<< "$CLAUDE_TOOL_INPUT" 2>/dev/null || true)
fi

[ -z "$FILE_PATH" ] && exit 0  # No file_path, nothing to check

# Absolute path of target file
TARGET_ABS=$(cd "$(dirname "$FILE_PATH" 2>/dev/null || echo ".")" 2>/dev/null && pwd)
[ -z "$TARGET_ABS" ] && exit 0  # Can't resolve, skip

# Current shell's git toplevel
CURRENT_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$CURRENT_TOPLEVEL" ] && exit 0  # Not in a git repo, nothing to check

# Target's git toplevel (if it's under any git repo)
TARGET_TOPLEVEL=$(cd "$TARGET_ABS" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$TARGET_TOPLEVEL" ] && exit 0  # Target not in any git repo (e.g., /tmp), that's fine

# If target is in a DIFFERENT git repo than current shell, warn
if [ "$TARGET_TOPLEVEL" != "$CURRENT_TOPLEVEL" ]; then
  printf "WARNING: File will be written to different git working tree:\n" >&2
  printf "  Current shell: %s\n" "$CURRENT_TOPLEVEL" >&2
  printf "  Target file:   %s\n" "$TARGET_TOPLEVEL" >&2
  # Never block — exit 0
fi

exit 0
