#!/usr/bin/env bash
# tools/hooks/worktree-file-guard.sh
# Warn (never block) if a Write|Edit lands in a different git checkout/worktree than
# the current shell. Prevents subagent/session files being written to the wrong place.
# Reads the PreToolUse payload as JSON on stdin (matcher Write|Edit).

set -uo pipefail

# Payload source: stdin ONLY. $CLAUDE_TOOL_INPUT is NOT set by the harness — verified
# 2026-08-09 by dumping the hook environment (CLAUDE_PROJECT_DIR / CLAUDE_CODE_SESSION_ID
# / CLAUDE_PID are set; CLAUDE_TOOL_INPUT is empty and CLAUDE_FILE_PATH is absent).
# This guard read only that env var, so it had never fired. Its old primary extraction
# also used `grep -oP`, which BSD grep on macOS does not support — dead twice over.
# Mirrors the stdin-first shape of rm-guard.sh / prod-guard.sh / git-state-guard.sh.
#
# Drain stdin even when we intend to exit: bailing out before reading SIGPIPEs the
# caller that is still writing the payload (same reasoning as rm-guard.sh).
FILE_PATH=""
if [ ! -t 0 ]; then
  payload=$(cat 2>/dev/null || true)
  if [ -n "$payload" ]; then
    FILE_PATH=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get("file_path", "") or "")
except Exception:
    print("")
' 2>/dev/null || true)
  fi
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
