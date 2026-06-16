#!/usr/bin/env bash
# scripts/demo-preflight.sh
#
# MIRA Demo Preflight — CRA-278
# Validates all demo-critical services in <60 seconds.
#
# Usage (direct):
#   chmod +x scripts/demo-preflight.sh
#   doppler run --project factorylm --config prd -- bash scripts/demo-preflight.sh
#
# Usage (via Makefile):
#   make demo-preflight
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

# ── Color helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✅  ${1}${RESET}"; }
fail() { echo -e "${RED}❌  ${1}${RESET}"; }

# ── State ─────────────────────────────────────────────────────────────────────
TOTAL=0
FAILED=0
DATE=$(date '+%Y-%m-%d')

echo ""
echo "MIRA Demo Preflight — ${DATE}"
echo "──────────────────────────────────"

# ── 1. Doppler secrets present ────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
MISSING_SECRETS=()
for var in GROQ_API_KEY CEREBRAS_API_KEY GEMINI_API_KEY TELEGRAM_BOT_TOKEN STRIPE_WEBHOOK_SECRET; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    MISSING_SECRETS+=("$var")
  fi
done
if [ ${#MISSING_SECRETS[@]} -eq 0 ]; then
  pass "Doppler secrets present"
else
  fail "Doppler secrets missing: ${MISSING_SECRETS[*]}  →  [fix: doppler run --project factorylm --config prd -- env | grep <KEY>]"
  FAILED=$((FAILED + 1))
fi

# ── 2. VPS reachable ─────────────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
HTTP=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" https://app.factorylm.com/health 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "VPS reachable (app.factorylm.com)"
else
  fail "VPS unreachable (app.factorylm.com)  →  HTTP ${HTTP}  [fix: ssh root@165.245.138.91 'docker ps']"
  FAILED=$((FAILED + 1))
fi

# ── 3. mira-pipeline-saas live ───────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
PIPELINE_PAYLOAD='{"model":"llama-3.1-8b-instant","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'
PIPELINE_HTTP=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" \
  -X POST https://app.factorylm.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "$PIPELINE_PAYLOAD" 2>/dev/null || echo "000")
if [ "$PIPELINE_HTTP" = "200" ]; then
  pass "mira-pipeline-saas live"
else
  fail "mira-pipeline-saas  →  HTTP ${PIPELINE_HTTP}  [fix: ssh root@165.245.138.91 \"docker restart mira-pipeline-saas\"]"
  FAILED=$((FAILED + 1))
fi

# ── 4. mira-hub login page ────────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
HUB_HTTP=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" https://app.factorylm.com/hub/login 2>/dev/null || echo "000")
if [ "$HUB_HTTP" = "200" ]; then
  pass "mira-hub login page"
else
  fail "mira-hub login page  →  HTTP ${HUB_HTTP}  [fix: ssh root@165.245.138.91 \"docker restart mira-hub\"]"
  FAILED=$((FAILED + 1))
fi

# ── 5. Atlas CMMS API ─────────────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
ATLAS_HTTP=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" https://app.factorylm.com/api/atlas/health 2>/dev/null || echo "000")
if [ "$ATLAS_HTTP" = "200" ] || [ "$ATLAS_HTTP" = "401" ]; then
  pass "Atlas CMMS API up (HTTP ${ATLAS_HTTP})"
else
  fail "Atlas CMMS API  →  HTTP ${ATLAS_HTTP}  [fix: ssh root@165.245.138.91 \"docker restart atlas-api\"]"
  FAILED=$((FAILED + 1))
fi

# ── 6. QR scan endpoint ───────────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
SCAN_HTTP=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" https://app.factorylm.com/scan/ 2>/dev/null || echo "000")
if [ "$SCAN_HTTP" = "200" ]; then
  pass "QR scan endpoint (/scan/)"
else
  fail "QR scan endpoint  →  HTTP ${SCAN_HTTP}  [fix: ssh root@165.245.138.91 \"docker restart mira-web\"]"
  FAILED=$((FAILED + 1))
fi

# ── 7. Photo ingest endpoint ──────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
INGEST_HTTP=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" https://app.factorylm.com/ingest/health 2>/dev/null || echo "000")
# Accept 200 or 404 (up but no health route); only fail on 000 (connection refused/timeout)
if [ "$INGEST_HTTP" != "000" ]; then
  pass "Photo ingest endpoint (HTTP ${INGEST_HTTP})"
else
  fail "Photo ingest endpoint  →  no response  [fix: ssh root@165.245.138.91 \"docker restart mira-ingest\"]"
  FAILED=$((FAILED + 1))
fi

# ── 8. NeonDB env var present ─────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
NEON_URL="${NEON_DATABASE_URL:-}"
if [ -n "$NEON_URL" ]; then
  pass "NeonDB URL present (NEON_DATABASE_URL)"
else
  fail "NeonDB URL missing  →  NEON_DATABASE_URL is empty  [fix: doppler secrets set NEON_DATABASE_URL <url> --project factorylm --config prd]"
  FAILED=$((FAILED + 1))
fi

# ── 9. Stripe live mode ───────────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
STRIPE_KEY="${STRIPE_SECRET_KEY:-}"
if [[ "$STRIPE_KEY" == sk_live_* ]]; then
  pass "Stripe live mode (sk_live_…)"
else
  if [ -z "$STRIPE_KEY" ]; then
    fail "Stripe key missing  →  STRIPE_SECRET_KEY not set  [fix: doppler secrets set STRIPE_SECRET_KEY <key> --project factorylm --config prd]"
  else
    fail "Stripe not in live mode  →  key starts with '${STRIPE_KEY:0:10}…' (expected sk_live_)  [fix: replace STRIPE_SECRET_KEY with live key in Doppler]"
  fi
  FAILED=$((FAILED + 1))
fi

# ── 10. Telegram bot reachable ────────────────────────────────────────────────
TOTAL=$((TOTAL + 1))
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$BOT_TOKEN" ]; then
  fail "Telegram bot  →  TELEGRAM_BOT_TOKEN not set (skipping API call)  [fix: doppler secrets set TELEGRAM_BOT_TOKEN <token>]"
  FAILED=$((FAILED + 1))
else
  TG_RESPONSE=$(curl -sf --max-time 5 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" 2>/dev/null || echo "")
  if echo "$TG_RESPONSE" | grep -q '"ok":true'; then
    pass "Telegram bot reachable (getMe ok)"
  else
    fail "Telegram bot  →  getMe did not return ok:true  [fix: verify TELEGRAM_BOT_TOKEN in Doppler; check bot not revoked via @BotFather]"
    FAILED=$((FAILED + 1))
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
PASSED=$((TOTAL - FAILED))
echo "──────────────────────────────────"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}${PASSED}/${TOTAL} checks passed. All green — demo ready.${RESET}"
  exit 0
else
  echo -e "${RED}${PASSED}/${TOTAL} checks passed. ${FAILED} FAILED — see above.${RESET}"
  exit 1
fi
