#!/usr/bin/env bash
# tools/hooks/prod-guard.sh
# PreToolUse(Bash) hook — blocks autonomous Claude sessions from running
# production-MUTATING commands (container restart/compose on prod services,
# nginx reload, systemctl/kubectl mutations, file writes / deploys over SSH to
# the prod host). READ-ONLY inspection of prod is allowed.
#
# Doctrine: per the overnight-regression playbook, "NEVER let overnight sessions
# deploy to / change production". But *looking* at prod (docker ps, logs,
# inspect, cat, ls, grep, status) is safe and useful — so reads pass, writes deny.
# Commits + branch pushes are still allowed; the human deploys in the morning.
#
# Override: MIRA_ALLOW_PROD=1 (set per-shell when you're consciously deploying).
#
# Model:
#   1. HARD_DENY  — always blocked: scp/rsync TO prod, and prod-service mutations
#                   (docker restart/stop/down/kill/up/create/compose, nginx -s,
#                    systemctl restart/stop/…, kubectl apply/delete/…). These match
#                    whether run locally or inside an `ssh prod "…"` remote string.
#   2. SSH-to-prod — allowed ONLY if the command carries no MUTATION verb. A
#                    read-only `ssh root@prod "docker ps"` passes; an `ssh root@prod
#                    "rm …"` / "git pull" / "psql" / "docker exec" is denied.
#
# Limitation: shell output-redirection that writes a file (e.g. `echo x > /etc/y`)
# via bare `>` is not pattern-matched; the explicit write verbs below cover the
# real mutation surface (docker/systemctl/git/psql/rm/tee/sed -i/dd/…).
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

deny() {
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"$1"}}
EOF
  exit 0
}

# A prod target: the prod host by name, any *.factorylm.com, root@<host>, or the
# prod VPS IP. Used to scope the SSH read/write split and scp/rsync deny.
PROD_HOST='(factorylm-prod|\.factorylm\.com|root@|165\.245\.138\.91)'

# Command-position anchor: a verb only counts as an INVOKED command when it sits
# at the start of the string or right after a shell separator (; & | `( ). This
# stops false positives where a verb merely appears as TEXT — e.g. a git commit
# message or an echo describing "ssh root@prod / docker restart / git pull".
CMDSTART='(^|[;&|`(])[[:space:]]*'

# Mutation verbs — state-changing commands. UNANCHORED (match anywhere) because
# this is consulted ONLY inside the step-2 SSH-to-prod branch, whose entry is
# already gated by an anchored ssh/scp/rsync invocation against a prod host. A
# remote verb sits after the quote (`ssh prod "rm …"`), so it must be matched
# anywhere; the commit-message false positive can't reach here (step-2 won't fire
# for a non-ssh command). Short verbs use \b so they don't match substrings.
MUTATION='(\brm\b|\bmv\b|\bdd\b|\btee\b|\btruncate\b|\bmkdir\b|\brmdir\b|\bchmod\b|\bchown\b|\bln\b|sed[[:space:]]+-i|docker[[:space:]]+(restart|stop|start|kill|rm|rmi|down|up|create|compose|build|pull|push|tag|prune|cp|exec|run|update|scale|load|import)|systemctl[[:space:]]+(restart|stop|start|reload|enable|disable|mask|daemon-reload)|nginx[[:space:]]+-s|kubectl[[:space:]]+(apply|delete|rollout|edit|patch|scale|replace|create|cordon|drain|annotate|label)|\bpsql\b|certbot|crontab|pkill|\bkill\b|apt(-get)?[[:space:]]+(install|remove|purge|upgrade)|(yum|dnf)[[:space:]]+(install|remove|update)|git[[:space:]]+(push|pull|checkout|reset|clean|merge|rebase)|(npm|pnpm)[[:space:]]+(install|i|ci|publish)|bun[[:space:]]+(install|add|remove)|doppler[[:space:]]+secrets[[:space:]]+(set|delete|upload))'

# 1. HARD_DENY — LOCAL prod-service mutations + file transfer TO prod. Anchored to
#    CMDSTART so a commit message / echo mentioning these phrases is not blocked.
HARD_DENY=''"$CMDSTART"'scp[^|;&]*'"$PROD_HOST"'|'"$CMDSTART"'rsync[^|;&]*'"$PROD_HOST"'|'"$CMDSTART"'docker[[:space:]]+(restart|stop|down|kill|up|create)[[:space:]]+[^|;&]*(mira-pipeline|mira-core|mira-mcp|mira-ingest|mira-web|atlas-api|mira-bridge|mira-bot-)|'"$CMDSTART"'docker[[:space:]]+compose|'"$CMDSTART"'nginx[[:space:]]+-s[[:space:]]+reload|'"$CMDSTART"'systemctl[[:space:]]+(restart|stop|reload|start|enable|disable)[[:space:]]+(mira-|nginx|atlas-)|'"$CMDSTART"'kubectl[[:space:]]+(apply|delete|rollout|patch|edit|scale|replace)'

if printf '%s' "$cmd" | grep -qiE "$HARD_DENY"; then
  deny "Production-mutating command blocked by tools/hooks/prod-guard.sh. Commit + push to a branch instead. Human deploys with MIRA_ALLOW_PROD=1 after morning review."
fi

# 2. SSH/scp/rsync INVOKED against a prod host: allow read-only, deny mutations.
#    The invocation must be at a command position (CMDSTART) AND a prod host must
#    appear in the command — so a commit message saying "ssh root@prod" is ignored.
if printf '%s' "$cmd" | grep -qiE "${CMDSTART}(ssh|scp|rsync)[[:space:]]" \
   && printf '%s' "$cmd" | grep -qiE "$PROD_HOST"; then
  if printf '%s' "$cmd" | grep -qiE "$MUTATION"; then
    deny "Mutating command over SSH to prod blocked by tools/hooks/prod-guard.sh (read-only prod inspection is allowed; this command changes state). Use MIRA_ALLOW_PROD=1 to override."
  fi
  # read-only prod inspection — allow
  exit 0
fi

exit 0
