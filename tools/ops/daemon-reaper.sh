#!/usr/bin/env bash
# tools/ops/daemon-reaper.sh
# Kill long-lived LSP and MCP daemons that outlive their parent Claude Code
# session. Born from the 2026-05-12 Bravo incident: 4 pyright processes were
# burning 685% CPU and 6 GB RAM on a 16 GB node because a 26h Claude session
# kept respawning them via PostToolUse hooks.
#
# Targets:
#   - pyright LSP daemons running > 4h with no recent CPU activity
#   - *-mcp* node daemons running > 12h with no parent claude process
#   - claude itself running > 24h (logs warning, does not auto-kill)
#
# Idempotent. Safe to run on any node every 6h via launchd.
# Writes one JSONL summary line to /cluster/betterclaw/logs/daemon-reaper-<NODE>.jsonl

set -uo pipefail

NODE_NAME="$(hostname -s | tr '[:upper:]' '[:lower:]')"
LOG_DIR="${DAEMON_REAPER_LOG_DIR:-/cluster/betterclaw/logs}"
LOG_FILE="${LOG_DIR}/daemon-reaper-${NODE_NAME}.jsonl"
DRY_RUN="${DAEMON_REAPER_DRY_RUN:-0}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$LOG_DIR" 2>/dev/null || LOG_FILE="/tmp/daemon-reaper-${NODE_NAME}.jsonl"

killed_pyright=0
killed_mcp=0
warn_claude=0

# Helper: seconds since process start using ps etime (DD-HH:MM:SS or HH:MM:SS or MM:SS)
proc_age_seconds() {
  local pid=$1
  local etime
  etime=$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ')
  [ -z "$etime" ] && { echo 0; return; }
  python3 - "$etime" <<'PY'
import sys
s = sys.argv[1]
days, _, rest = s.partition("-")
if not rest:
    rest, days = days, "0"
parts = list(map(int, rest.split(":")))
while len(parts) < 3:
    parts.insert(0, 0)
h, m, sec = parts
print(int(days) * 86400 + h * 3600 + m * 60 + sec)
PY
}

# Helper: cpu-time consumed (proxy for "is it actually working"). Format MM:SS.
proc_cpu_seconds() {
  local pid=$1
  local cput
  cput=$(ps -p "$pid" -o time= 2>/dev/null | tr -d ' ')
  [ -z "$cput" ] && { echo 0; return; }
  python3 - "$cput" <<'PY'
import sys
s = sys.argv[1]
days, _, rest = s.partition("-")
if not rest:
    rest, days = days, "0"
parts = list(map(int, rest.split(":")))
while len(parts) < 3:
    parts.insert(0, 0)
h, m, sec = parts
print(int(days) * 86400 + h * 3600 + m * 60 + sec)
PY
}

# 1. Reap pyright daemons > 4h with low recent activity
for pid in $(pgrep -f 'pyright' 2>/dev/null); do
  age=$(proc_age_seconds "$pid")
  if [ "$age" -gt 14400 ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "[dry-run] would kill pyright pid=$pid age=${age}s"
    else
      kill -TERM "$pid" 2>/dev/null && killed_pyright=$((killed_pyright + 1))
    fi
  fi
done

# 2. Reap *-mcp* daemons > 12h whose parent claude process is gone
for pid in $(pgrep -f 'mcp' 2>/dev/null); do
  age=$(proc_age_seconds "$pid")
  if [ "$age" -gt 43200 ]; then
    ppid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')
    if [ -n "$ppid" ] && ! ps -p "$ppid" -o command= 2>/dev/null | grep -q claude; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "[dry-run] would kill mcp pid=$pid age=${age}s ppid=$ppid"
      else
        kill -TERM "$pid" 2>/dev/null && killed_mcp=$((killed_mcp + 1))
      fi
    fi
  fi
done

# 3. Warn (do not kill) on claude sessions > 24h
for pid in $(pgrep -f 'claude --dangerously-skip-permissions\|^claude$\| claude ' 2>/dev/null); do
  age=$(proc_age_seconds "$pid")
  if [ "$age" -gt 86400 ]; then
    warn_claude=$((warn_claude + 1))
  fi
done

# Emit JSONL summary
printf '{"ts":"%s","node":"%s","killed_pyright":%d,"killed_mcp":%d,"long_claude_sessions":%d,"dry_run":%s}\n' \
  "$TS" "$NODE_NAME" "$killed_pyright" "$killed_mcp" "$warn_claude" "$DRY_RUN" >> "$LOG_FILE"

exit 0
