#!/usr/bin/env bash
# tools/ops/cluster-status.sh
# Pretty-print the latest node-health sample from each Mac Mini.
# Reads /cluster/betterclaw/logs/node-health-<NODE>.jsonl (last line per file)
# and prints a one-screen status table. Run on Alpha or any node with cluster
# mount; safe to run from anywhere with SSH access to all three.
#
# Usage:
#   bash tools/ops/cluster-status.sh             # local logs (cluster mount)
#   bash tools/ops/cluster-status.sh --ssh       # SSH to each node + tail
#
# Exit code: 0 ok, 1 any node over thresholds.

set -uo pipefail

LOG_DIR="${NODE_HEALTH_LOG_DIR:-/cluster/betterclaw/logs}"
MODE="${1:---local}"

# Thresholds (any one breached → exit 1)
TH_LOAD_PER_CORE=1.0
TH_RAM_FREE_GB=0.5
TH_SWAP_USED_PCT=50
TH_DISK_PCT=85

print_header() {
  printf '%-8s | %-6s | %-9s | %-9s | %-7s | %-6s | %s\n' \
    "node" "load1" "free_GB" "swap_GB" "disk%" "ext?" "top CPU"
  printf -- '---------+--------+-----------+-----------+---------+--------+--------------\n'
}

print_row() {
  local node=$1 sample=$2
  python3 - "$node" "$sample" <<'PY'
import sys, json
node, raw = sys.argv[1], sys.argv[2]
try:
    d = json.loads(raw)
except Exception:
    print(f"{node:<8} | parse error")
    sys.exit(0)
load = d.get("load1", 0)
ram = d.get("ram_free_gb", 0)
swap_u = d.get("swap_used_gb", 0)
swap_t = d.get("swap_total_gb", 0) or 1
swap_pct = round(swap_u / swap_t * 100)
disk = d.get("disk_pct", 0)
ext = "Y" if d.get("ext_ssd_mounted") else "-"
top = d.get("top_cpu", [])
top_str = ", ".join(f"{t['cmd']}={t['pct']}%" for t in top[:2]) or "-"
print(f"{node:<8} | {load:<6} | {ram:<9} | {swap_u}/{swap_t:<5} | {disk:<7} | {ext:<6} | {top_str}")
PY
}

over_threshold() {
  local sample=$1
  python3 - "$sample" "$TH_LOAD_PER_CORE" "$TH_RAM_FREE_GB" "$TH_SWAP_USED_PCT" "$TH_DISK_PCT" <<'PY'
import sys, json, multiprocessing
sample, lpc, ramg, swp, dpct = sys.argv[1:6]
try:
    d = json.loads(sample)
except Exception:
    sys.exit(2)
cores = multiprocessing.cpu_count() or 8
breaches = []
if d.get("load1", 0) > float(lpc) * cores: breaches.append("load")
if d.get("ram_free_gb", 99) < float(ramg): breaches.append("ram")
swap_u = d.get("swap_used_gb", 0); swap_t = d.get("swap_total_gb", 1) or 1
if (swap_u / swap_t * 100) > float(swp): breaches.append("swap")
if d.get("disk_pct", 0) > float(dpct): breaches.append("disk")
sys.exit(1 if breaches else 0)
PY
}

nodes=(alpha bravo-lan charlie)
breached=0

print_header
for n in "${nodes[@]}"; do
  short=$(echo "$n" | sed 's/-lan//')
  if [ "$MODE" = "--ssh" ] && [ "$n" != "$(hostname -s | tr '[:upper:]' '[:lower:]')" ]; then
    sample=$(ssh -o ConnectTimeout=3 "$n" "tail -1 ${LOG_DIR}/node-health-${short}.jsonl 2>/dev/null" || echo "")
  else
    sample=$(tail -1 "${LOG_DIR}/node-health-${short}.jsonl" 2>/dev/null || echo "")
  fi
  if [ -z "$sample" ]; then
    printf '%-8s | (no recent sample)\n' "$short"
    breached=1
    continue
  fi
  print_row "$short" "$sample"
  if ! over_threshold "$sample"; then
    breached=1
  fi
done

[ "$breached" -eq 1 ] && exit 1
exit 0
