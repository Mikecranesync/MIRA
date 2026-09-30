#!/usr/bin/env bash
# tools/hooks/shared-root-file-guard.sh
# PreToolUse(Write|Edit) hook — deterministic floor against one run overwriting
# another run's repo-root PLAN.md / HANDOFF.md.
#
# Thin wrapper, same contract as rm-guard.sh: the PreToolUse payload arrives as
# JSON on stdin and the analysis lives in the adjacent Python module so it can be
# unit-tested. Emits PreToolUse permission JSON on deny, nothing on allow.
#
# Override: MIRA_ALLOW_SHARED_ROOT=1 (per-shell, human).
# Doctrine: .claude/rules/shared-root-file-ownership.md

set -uo pipefail

# Drain stdin FIRST so every early exit below is safe — exiting before reading
# SIGPIPEs the caller that is still writing the payload (same reasoning as
# rm-guard.sh).
payload=""
if [ ! -t 0 ]; then
  payload=$(cat 2>/dev/null || true)
fi

# Fail open, but never silently: a break in the payload plumbing must not look
# identical to "nothing to inspect" — that is exactly how the dead-hook class of
# 2026-08-09 stayed invisible for months.
if [ -z "$payload" ]; then
  echo "$(basename "$0"): no PreToolUse payload on stdin - NOT inspected, allowing." >&2
  exit 0
fi

if [ "${MIRA_ALLOW_SHARED_ROOT:-0}" = "1" ]; then
  exit 0
fi

# Cheap reject: if none of the shared basenames appear anywhere in the payload,
# allow without spawning python. Keeps the common Write/Edit path free.
case "$payload" in
  *PLAN.md*|*HANDOFF.md*|*STATE.md*|*NOTES.md*|*TODO.md*|*RESUME.md*|*SESSION.md*) : ;;
  *) exit 0 ;;
esac

printf '%s' "$payload" | python3 "$(dirname "$0")/shared_root_file_guard.py"
exit 0
