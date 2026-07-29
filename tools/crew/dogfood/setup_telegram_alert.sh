#!/usr/bin/env bash
# One-shot finisher for the dogfood Telegram alert.
#
# Prereq: the operator has messaged the staging bot @Mira_stagong_bot (tap Start,
# or send any text) so its getUpdates carries their private chat id.
#
# What it does:
#   1) Reads the STAGING bot token from Doppler factorylm/stg.
#   2) Polls getUpdates and extracts the newest PRIVATE chat id (the operator).
#   3) Stores it as DOGFOOD_ALERT_CHAT_ID in Doppler stg (the launchd cron reads this).
#   4) Sets repo secrets DOGFOOD_ALERT_CHAT_ID + TELEGRAM_BOT_TOKEN_STG (the GitHub
#      dead-man's-switch dogfood-judge-heartbeat.yml reads these) — needs `gh` admin.
#   5) Sends a one-time test DM so you can confirm delivery.
#
# Re-runnable and idempotent. Never prints the token.
#   Run: bash tools/crew/dogfood/setup_telegram_alert.sh [--chat-id <id>]
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1

CHAT_OVERRIDE=""
[ "${1:-}" = "--chat-id" ] && CHAT_OVERRIDE="${2:-}"

TOK="$(doppler secrets get TELEGRAM_BOT_TOKEN_STG --project factorylm --config stg --plain 2>/dev/null)"
[ -z "$TOK" ] && { echo "ERROR: TELEGRAM_BOT_TOKEN_STG not in Doppler factorylm/stg"; exit 1; }

if [ -n "$CHAT_OVERRIDE" ]; then
  CHAT="$CHAT_OVERRIDE"
  echo "Using provided chat id: $CHAT"
else
  echo "Reading getUpdates for the newest private chat (message @Mira_stagong_bot first)..."
  CHAT="$(curl -s --max-time 10 "https://api.telegram.org/bot${TOK}/getUpdates" | python3 -c '
import sys,json
try: d=json.load(sys.stdin)
except Exception: raise SystemExit
for u in reversed(d.get("result",[])):
    m=u.get("message") or u.get("edited_message") or {}
    c=m.get("chat",{})
    if c.get("type")=="private" and c.get("id"):
        print(c["id"]); break
' 2>/dev/null)"
  [ -z "$CHAT" ] && { echo "ERROR: no private chat found in getUpdates — message @Mira_stagong_bot, then re-run (or pass --chat-id <id>)."; exit 1; }
  echo "Detected chat id: $CHAT"
fi

echo "Storing DOGFOOD_ALERT_CHAT_ID in Doppler factorylm/stg ..."
if printf '%s' "$CHAT" | doppler secrets set DOGFOOD_ALERT_CHAT_ID --project factorylm --config stg >/dev/null 2>&1; then
  echo "  Doppler stg: set"
else
  echo "  WARN: could not set Doppler secret (need a writable token); set it manually:"
  echo "    doppler secrets set DOGFOOD_ALERT_CHAT_ID=$CHAT --project factorylm --config stg"
fi

echo "Setting repo secrets for the GitHub heartbeat workflow ..."
if gh secret set DOGFOOD_ALERT_CHAT_ID --repo Mikecranesync/MIRA --body "$CHAT" >/dev/null 2>&1; then
  echo "  gh secret DOGFOOD_ALERT_CHAT_ID: set"
else
  echo "  WARN: could not set gh secret DOGFOOD_ALERT_CHAT_ID (need admin) — set in repo Settings › Secrets."
fi
if gh secret set TELEGRAM_BOT_TOKEN_STG --repo Mikecranesync/MIRA --body "$TOK" >/dev/null 2>&1; then
  echo "  gh secret TELEGRAM_BOT_TOKEN_STG: set"
else
  echo "  WARN: could not set gh secret TELEGRAM_BOT_TOKEN_STG (need admin) — set in repo Settings › Secrets."
fi

echo "Sending a test DM ..."
msg="✅ FactoryLM Dogfood alerts are wired. You'll get a Telegram DM here on a RED run (customer-blocking) or if the 4h routine stalls (>9h). This is a one-time test."
if curl -s --max-time 15 "https://api.telegram.org/bot${TOK}/sendMessage" \
     --data-urlencode "chat_id=${CHAT}" \
     --data-urlencode "text=${msg}" \
     --data-urlencode "disable_web_page_preview=true" | grep -q '"ok":true'; then
  echo "  Test DM sent to $CHAT — check Telegram."
else
  echo "  ERROR: test DM failed. Confirm you messaged @Mira_stagong_bot and the chat id is right."
  exit 1
fi
echo "Done. Dogfood → Telegram alerting is live."
