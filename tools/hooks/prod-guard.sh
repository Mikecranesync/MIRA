#!/usr/bin/env bash
# tools/hooks/prod-guard.sh
# PreToolUse(Bash) hook — blocks autonomous Claude sessions from running
# production-mutating commands (SSH to factorylm-prod, container restart on
# prod services, nginx reload, kubectl mutations).
#
# Rationale: per the overnight-regression playbook, "NEVER let overnight
# sessions deploy to production". Commits + branch pushes are still allowed —
# the human reviews and deploys in the morning.
#
# Override: MIRA_ALLOW_PROD=1 (set per-shell when you're consciously deploying).
#
# Reads PreToolUse JSON from stdin OR $CLAUDE_TOOL_INPUT (legacy MIRA hooks).
# Emits PreToolUse permission JSON on stdout.

set -uo pipefail

# Operator override — silent allow.
if [ "${MIRA_ALLOW_PROD:-0}" = "1" ]; then
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

# Patterns scoped narrowly so dev SSH and local docker still work.
# - SSH to anything containing factorylm-prod, *.factorylm.com, or root@
# - docker (restart|stop|down|kill) on a known prod service name
# - nginx -s reload
# - systemctl (restart|stop|reload) for mira-/nginx/atlas-
# - kubectl apply|delete|rollout
# - scp/rsync targeting factorylm prod hosts
PATTERN='(ssh[^|;&]*factorylm-prod)|(ssh[^|;&]*\.factorylm\.com)|(ssh[^|;&]*[[:space:]]+root@)|(docker[[:space:]]+(restart|stop|down|kill)[[:space:]]+(mira-pipeline|mira-core|mira-mcp|atlas-api|mira-bridge|mira-bot-))|(nginx[[:space:]]+-s[[:space:]]+reload)|(systemctl[[:space:]]+(restart|stop|reload)[[:space:]]+(mira-|nginx|atlas-))|(kubectl[[:space:]]+(apply|delete|rollout))|(scp[^|;&]*factorylm-prod)|(rsync[^|;&]*factorylm-prod)'

if printf '%s' "$cmd" | grep -qiE "$PATTERN"; then
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Production deploy blocked by tools/hooks/prod-guard.sh. Commit + push to a branch instead. Human deploys with MIRA_ALLOW_PROD=1 after morning review."}}
EOF
  exit 0
fi

exit 0
