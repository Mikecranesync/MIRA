#!/usr/bin/env bash
# Pull recent real user sessions + photos from mira-pipeline-saas on VPS.
# Filters out eval-* sessions. Writes into tools/audit/app-screenshots/YYYY-MM-DD-session-audit/.
#
# Usage:
#   bash tools/audit/pull-vps-sessions.sh [N]         # default N=10
#
# Requires: ssh vps alias configured, docker exec access to mira-pipeline-saas.
# PIPELINE_API_KEY is read from the container's environment (not exported locally).

set -euo pipefail

N="${1:-10}"
OUT="tools/audit/app-screenshots/$(date +%Y-%m-%d)-session-audit"
mkdir -p "$OUT"

echo "==> Listing photo files (proxy for real sessions with images)…"
MAPPING="$(ssh vps "ls -lt --time-style=long-iso /opt/mira/data/session_photos/ | awk 'NR>1 && \$NF ~ /\\.jpg$/ {print \$(NF-2)\"T\"\$(NF-1)\" \"\$NF}' | head -$N")"

if [[ -z "$MAPPING" ]]; then
    echo "No session photos found on VPS." >&2
    exit 1
fi

echo "$MAPPING" | awk '{print $2}' | sed 's/\.jpg$//' > "$OUT/chat_ids.txt"
echo "==> Found $(wc -l < "$OUT/chat_ids.txt") sessions:"
cat "$OUT/chat_ids.txt"

echo
echo "==> Fetching state JSON for each…"
while read -r CID; do
    [[ -z "$CID" ]] && continue
    ssh vps "docker exec mira-pipeline-saas sh -c 'curl -s -H \"Authorization: Bearer \$PIPELINE_API_KEY\" http://localhost:9099/v1/debug/state/$CID'" > "$OUT/$CID.json"
    echo "  state → $OUT/$CID.json ($(wc -c < "$OUT/$CID.json") bytes)"
done < "$OUT/chat_ids.txt"

echo
echo "==> Copying photos…"
while read -r CID; do
    [[ -z "$CID" ]] && continue
    scp "vps:/opt/mira/data/session_photos/$CID.jpg" "$OUT/$CID.jpg" 2>/dev/null || echo "  (no photo for $CID)"
done < "$OUT/chat_ids.txt"

echo
echo "==> Saving mapping…"
echo "$MAPPING" > "$OUT/mapping.txt"

echo
echo "==> Done. Audit ready at $OUT/"
ls -la "$OUT"
