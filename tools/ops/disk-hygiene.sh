#!/usr/bin/env bash
# tools/ops/disk-hygiene.sh
# Daily 3am cleanup on each Mac Mini node. Idempotent.
# Targets the accretion patterns that filled bravo to 89% over 2 months:
#   - Homebrew cellar+cask leftovers (weekly only, Sundays)
#   - Stale Docker images/volumes/networks (older than 1 week)
#   - Large old caches in ~/Library/Caches
#   - npm _npx exec caches > 30 days old
#   - Application logs > 30 days old
#
# Excludes:
#   - ~/.ollama (model store — intentional and large)
#   - /Volumes/FactoryLM/* (external SSD — its own retention)
#
# Wired via com.factorylm.disk-hygiene.plist (StartCalendarInterval Hour=3 Min=0).
# JSONL summary appended to /cluster/betterclaw/logs/disk-hygiene-<NODE>.jsonl.

set -uo pipefail

NODE_NAME="$(hostname -s | tr '[:upper:]' '[:lower:]')"
LOG_DIR="${DISK_HYGIENE_LOG_DIR:-/cluster/betterclaw/logs}"
LOG_FILE="${LOG_DIR}/disk-hygiene-${NODE_NAME}.jsonl"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DAY_OF_WEEK="$(date +%u)"  # 1-7, Mon-Sun

mkdir -p "$LOG_DIR" 2>/dev/null || LOG_FILE="/tmp/disk-hygiene-${NODE_NAME}.jsonl"

disk_before_pct=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
disk_before_gb=$(df -g / | awk 'NR==2{print $4}')

actions=()

# 1. Homebrew cleanup — Sundays only (DOW=7)
if [ "$DAY_OF_WEEK" = "7" ]; then
  if [ -x /opt/homebrew/bin/brew ]; then
    /opt/homebrew/bin/brew cleanup -s >/dev/null 2>&1 && actions+=("brew_cleanup")
  fi
fi

# 2. Docker prune — only if Docker reachable; only week-old objects
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    docker system prune -f --filter "until=168h" >/dev/null 2>&1 && actions+=("docker_prune")
  fi
fi

# 3. Trim large old caches
if [ -d "$HOME/Library/Caches" ]; then
  find "$HOME/Library/Caches" -type f -size +100M -mtime +14 -delete 2>/dev/null
  actions+=("caches_trimmed")
fi

# 4. Trim stale npm _npx exec caches (every time a Claude session runs `npx -y`
#    a new dir gets created; old ones never get reaped)
if [ -d "$HOME/.npm/_npx" ]; then
  find "$HOME/.npm/_npx" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null
  actions+=("npx_trimmed")
fi

# 5. Truncate old application logs
if [ -d "$HOME/Library/Logs" ]; then
  find "$HOME/Library/Logs" -type f -name "*.log" -mtime +30 -delete 2>/dev/null
  actions+=("logs_trimmed")
fi

# 6. Old /tmp leftovers from this user
find /tmp -maxdepth 2 -user "$(whoami)" -mtime +7 -type f -delete 2>/dev/null
actions+=("tmp_trimmed")

disk_after_pct=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
disk_after_gb=$(df -g / | awk 'NR==2{print $4}')

actions_json=$(printf '%s\n' "${actions[@]}" | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')

printf '{"ts":"%s","node":"%s","disk_before_pct":%s,"disk_after_pct":%s,"disk_before_free_gb":%s,"disk_after_free_gb":%s,"dow":"%s","actions":%s}\n' \
  "$TS" "$NODE_NAME" "${disk_before_pct:-0}" "${disk_after_pct:-0}" \
  "${disk_before_gb:-0}" "${disk_after_gb:-0}" "$DAY_OF_WEEK" "$actions_json" >> "$LOG_FILE"

exit 0
