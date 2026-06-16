#!/usr/bin/env bash
# tools/ops/node-health.sh
# Emit a one-line JSONL health sample for the local Mac Mini node.
# Runs every 5 min via com.factorylm.node-health.plist.
# Aggregator on Alpha tails all three streams and pages Discord on thresholds.
#
# Output line:
#   {"ts":"...", "node":"bravo", "load1":1.2, "ram_free_gb":3.4,
#    "ram_total_gb":16, "swap_used_gb":0.5, "swap_total_gb":10,
#    "disk_pct":62, "disk_free_gb":175, "uptime_days":3.4,
#    "top_cpu":[{"cmd":"ollama","pct":45}, ...]}

set -uo pipefail

NODE_NAME="$(hostname -s | tr '[:upper:]' '[:lower:]')"
LOG_DIR="${NODE_HEALTH_LOG_DIR:-/cluster/betterclaw/logs}"
LOG_FILE="${LOG_DIR}/node-health-${NODE_NAME}.jsonl"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$LOG_DIR" 2>/dev/null || LOG_FILE="/tmp/node-health-${NODE_NAME}.jsonl"

# Load average (1m)
load1=$(uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/' | tr -d ' ')

# Memory: vm_stat reports in pages. macOS uses 16K pages on Apple Silicon.
mem_total_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
mem_total_gb=$(python3 -c "print(round($mem_total_bytes/1024/1024/1024, 1))")

page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)
free_pages=$(vm_stat | awk '/Pages free/{gsub(/\./,"",$3); print $3}')
spec_pages=$(vm_stat | awk '/Pages speculative/{gsub(/\./,"",$3); print $3}')
mem_free_gb=$(python3 -c "print(round(($free_pages + $spec_pages) * $page_size / 1024 / 1024 / 1024, 2))")

# Swap usage (sysctl format: total = 10240.00M  used = 0.00M  free = 10240.00M)
swap_line=$(sysctl vm.swapusage 2>/dev/null || echo "")
swap_total_gb=$(echo "$swap_line" | sed -E 's/.*total = ([0-9.]+)M.*/\1/' | python3 -c "import sys; v=float(sys.stdin.read().strip() or 0); print(round(v/1024, 2))")
swap_used_gb=$(echo "$swap_line" | sed -E 's/.*used = ([0-9.]+)M.*/\1/' | python3 -c "import sys; v=float(sys.stdin.read().strip() or 0); print(round(v/1024, 2))")

# Disk (data volume)
disk_pct=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
disk_free_gb=$(df -g / | awk 'NR==2{print $4}')

# Uptime in days
uptime_secs=$(sysctl -n kern.boottime 2>/dev/null | sed -E 's/.*sec = ([0-9]+).*/\1/' | python3 -c "
import sys, time
try:
    boot = int(sys.stdin.read().strip())
    print(round((time.time() - boot) / 86400, 2))
except Exception:
    print(0)
")

# Top 3 CPU consumers (command + percent)
top_cpu=$(ps -Ao pcpu,comm | sort -rn | head -3 | python3 -c "
import sys, json, os.path
rows = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    parts = line.split(None, 1)
    if len(parts) != 2: continue
    pct, cmd = parts
    try:
        pct = float(pct)
    except ValueError:
        continue
    if pct < 1: continue
    rows.append({'cmd': os.path.basename(cmd)[:40], 'pct': pct})
print(json.dumps(rows))
")

# Optional: external SSD presence (Bravo)
ext_ssd_mounted="false"
[ -d /Volumes/FactoryLM ] && ext_ssd_mounted="true"

printf '{"ts":"%s","node":"%s","load1":%s,"ram_free_gb":%s,"ram_total_gb":%s,"swap_used_gb":%s,"swap_total_gb":%s,"disk_pct":%s,"disk_free_gb":%s,"uptime_days":%s,"ext_ssd_mounted":%s,"top_cpu":%s}\n' \
  "$TS" "$NODE_NAME" "${load1:-0}" "${mem_free_gb:-0}" "${mem_total_gb:-0}" \
  "${swap_used_gb:-0}" "${swap_total_gb:-0}" "${disk_pct:-0}" "${disk_free_gb:-0}" \
  "${uptime_secs:-0}" "$ext_ssd_mounted" "${top_cpu:-[]}" >> "$LOG_FILE"

exit 0
