#!/usr/bin/env bash
# tools/hooks/stop-gate.sh
# Stop hook — blocks Claude from declaring "done" until lint/build gates pass on
# files changed during this session. Designed for unattended overnight runs:
# Anthropic docs note that LLM perf degrades over long contexts and that Stop
# hooks run deterministically while CLAUDE.md rules are advisory.
#
# Gates (only fire if relevant files changed):
#   1. ruff check on changed *.py
#   2. shellcheck (warning) on changed *.sh
#   3. mira-hub `npm run build` if any mira-hub/* changed and node_modules present
#
# Per-session escape hatch: MIRA_SKIP_STOP_GATE=1 (use sparingly; defeats the purpose).

set -uo pipefail

if [ "${MIRA_SKIP_STOP_GATE:-0}" = "1" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || { echo '{"decision":"allow"}'; exit 0; }

# Scope to what THIS branch added on top of main (not unrelated recent commits
# from other people). Falls back to HEAD~5 if no main branch reference exists.
MERGE_BASE=$(git merge-base origin/main HEAD 2>/dev/null \
          || git merge-base main HEAD 2>/dev/null \
          || git rev-parse HEAD~5 2>/dev/null \
          || git rev-parse HEAD 2>/dev/null \
          || echo "HEAD")
DIFF_BASE=$(git diff --name-only "${MERGE_BASE}...HEAD" 2>/dev/null || true)
DIFF_WORK=$(git diff --name-only 2>/dev/null || true)
DIFF_STAGED=$(git diff --cached --name-only 2>/dev/null || true)
CHANGED=$(printf '%s\n%s\n%s\n' "$DIFF_BASE" "$DIFF_WORK" "$DIFF_STAGED" \
  | sort -u | grep -v '^$' || true)

CHANGED_PY=$(echo "$CHANGED" | grep '\.py$' || true)
CHANGED_SH=$(echo "$CHANGED" | grep '\.sh$' || true)
CHANGED_HUB=$(echo "$CHANGED" | grep '^mira-hub/' || true)

FAILS=()

# Gate 1: ruff on changed Python files.
if [ -n "$CHANGED_PY" ] && command -v ruff >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  if ! ruff check $CHANGED_PY --quiet >/tmp/mira-stop-ruff.log 2>&1; then
    FAILS+=("ruff failed (cat /tmp/mira-stop-ruff.log)")
  fi
fi

# Gate 2: shellcheck on changed shell scripts.
if [ -n "$CHANGED_SH" ] && command -v shellcheck >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  if ! shellcheck -S warning $CHANGED_SH >/tmp/mira-stop-shellcheck.log 2>&1; then
    FAILS+=("shellcheck failed (cat /tmp/mira-stop-shellcheck.log)")
  fi
fi

# Gate 3: mira-hub TypeScript build.
if [ -n "$CHANGED_HUB" ] && [ -f "mira-hub/package.json" ] && [ -d "mira-hub/node_modules" ]; then
  if ! (cd mira-hub && npm run build >/tmp/mira-hub-stop-build.log 2>&1); then
    FAILS+=("mira-hub build failed (tail /tmp/mira-hub-stop-build.log)")
  fi
fi

if [ ${#FAILS[@]} -eq 0 ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

# Block with structured reason.
reason="Stop blocked — fix gates before claiming done: "
for f in "${FAILS[@]}"; do
  reason+="$f; "
done

# Use python for JSON-safe escaping (handles quotes, backslashes, newlines).
esc=$(printf '%s' "$reason" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${reason//\"/\\\"}")
printf '{"decision":"block","reason":%s}\n' "$esc"
exit 0
