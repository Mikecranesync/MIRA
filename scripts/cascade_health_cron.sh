#!/usr/bin/env bash
# cascade_health_cron.sh — periodic cascade health probe with Telegram alert on failure.
#
# Runs via launchd every 6 hours (see install/cascade-health.plist).
# Reads live keys from Doppler; sends a Telegram message to ADMIN_TELEGRAM_IDS on any
# AUTH_FAIL so the operator knows to rotate the key before it becomes load-bearing.
#
# Usage (manual):
#   doppler run --project factorylm --config prd -- bash scripts/cascade_health_cron.sh

set -euo pipefail

MIRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGFILE="$HOME/Library/Logs/mira-cascade-health.log"
PYTHON="python3.12"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE"; }

log "cascade health check starting"

output=$("$PYTHON" "$MIRA_DIR/scripts/check_cascade_health.py" 2>&1) || true
exit_code=$?

log "$output"

if [[ $exit_code -ne 0 ]]; then
    # Extract failing providers from output lines starting with ✗
    failing=$(echo "$output" | grep '^✗' | awk '{print $2}' | paste -sd ',' -)
    bot_token="${TELEGRAM_BOT_TOKEN:-}"
    # Send to all comma-separated admin IDs
    IFS=',' read -ra ids <<< "${ADMIN_TELEGRAM_IDS:-}"
    for chat_id in "${ids[@]}"; do
        chat_id="${chat_id// /}"
        [[ -z "$chat_id" ]] && continue
        msg="⚠️ MIRA cascade degraded on Bravo%0A%0AFailing: ${failing}%0A%0ARotate keys via Doppler:%0A%60doppler secrets set KEY=<new> --project factorylm --config prd%60%0AThen restart:%0A%60doppler run -- docker compose -f mira-bots/docker-compose.yml restart%60"
        curl -s -o /dev/null \
            "https://api.telegram.org/bot${bot_token}/sendMessage?chat_id=${chat_id}&text=${msg}&parse_mode=Markdown" || true
    done
    log "alert sent to ${#ids[@]} admin(s) for failing providers: $failing"
fi

log "cascade health check done (exit=$exit_code)"
exit $exit_code
