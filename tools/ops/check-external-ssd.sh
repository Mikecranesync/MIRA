#!/usr/bin/env bash
# tools/ops/check-external-ssd.sh
# Pre-launch guard for any service that depends on /Volumes/FactoryLM
# (e.g. Ollama after the 2026-05-12 migration). Exits 1 loud if the mount
# is missing — preferable to silently writing 21 GB of models back to the
# internal disk and refilling it.
#
# Usage in a launchd plist or wrapper:
#   bash tools/ops/check-external-ssd.sh && exec ollama serve
#
# Exit codes:
#   0 — mount present, writable, has >5 GB free
#   1 — mount missing or unwritable

set -uo pipefail

MOUNT="${EXTERNAL_SSD_MOUNT:-/Volumes/FactoryLM}"
MIN_FREE_GB="${EXTERNAL_SSD_MIN_FREE_GB:-5}"
LOG_FILE="/tmp/check-external-ssd.log"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

if [ ! -d "$MOUNT" ]; then
  printf '%s ERROR: %s not mounted\n' "$(ts)" "$MOUNT" | tee -a "$LOG_FILE" >&2
  exit 1
fi

probe="${MOUNT}/.factorylm-mount-probe"
if ! ( : > "$probe" ) 2>/dev/null; then
  printf '%s ERROR: %s not writable\n' "$(ts)" "$MOUNT" | tee -a "$LOG_FILE" >&2
  exit 1
fi
rm -f "$probe" 2>/dev/null

free_gb=$(df -g "$MOUNT" | awk 'NR==2{print $4}')
if [ "${free_gb:-0}" -lt "$MIN_FREE_GB" ]; then
  printf '%s ERROR: %s has only %s GB free (min %s)\n' "$(ts)" "$MOUNT" "$free_gb" "$MIN_FREE_GB" | tee -a "$LOG_FILE" >&2
  exit 1
fi

printf '%s OK: %s mounted, %s GB free\n' "$(ts)" "$MOUNT" "$free_gb" >> "$LOG_FILE"
exit 0
