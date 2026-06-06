#!/usr/bin/env bash
# QA-A — deterministic origin-root proxy test.
#
# Proves the origin-root proxy does the three things the Command Center needs to
# frame Ignition Perspective, against a MOCK gateway (no live Ignition, CI-able):
#   1. STRIPS X-Frame-Options + Content-Security-Policy from the client document
#      (else the Hub iframe is silently blank).
#   2. Forwards an ABSOLUTE-rooted asset 1:1 (/res/perspective/app.js → 200) —
#      the trait the per-id sub-path proxy cannot satisfy.
#   3. Forwards the WebSocket upgrade (→ 101) — Perspective's runtime.
#
# Usage:  bash run_test.sh        (needs docker; Colima on CHARLIE)
set -u
cd "$(dirname "$0")" || exit 2

# Colima docker socket on CHARLIE (no-op elsewhere).
export PATH="/opt/homebrew/bin:$PATH"
[ -S "$HOME/.colima/default/docker.sock" ] && export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"

PROXY="http://127.0.0.1:8899"
fails=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; fails=$((fails + 1)); }

cleanup() { docker compose -f docker-compose.test.yml down -v >/dev/null 2>&1; }
trap cleanup EXIT

echo "== bringing up mock gateway + origin-root proxy =="
docker compose -f docker-compose.test.yml up -d >/dev/null 2>&1 || { echo "compose up failed"; exit 2; }

# Wait for the proxy healthz.
for _ in $(seq 1 20); do
  [ "$(curl -sS -m2 -o /dev/null -w '%{http_code}' "$PROXY/healthz" 2>/dev/null)" = "200" ] && break
  sleep 1
done

echo "== assertions =="

# 1) Client document: 200, and X-Frame-Options / CSP STRIPPED.
hdr=$(curl -sS -m6 -D - -o /dev/null "$PROXY/data/perspective/client/ConvSimpleLive" 2>/dev/null)
echo "$hdr" | grep -qi "^HTTP/1.1 200" && pass "client doc 200" || fail "client doc not 200"
echo "$hdr" | grep -qi "x-frame-options"          && fail "X-Frame-Options NOT stripped" || pass "X-Frame-Options stripped"
echo "$hdr" | grep -qi "content-security-policy"  && fail "Content-Security-Policy NOT stripped" || pass "Content-Security-Policy stripped"

# 2) Absolute-rooted asset forwarded 1:1.
code=$(curl -sS -m6 -o /dev/null -w '%{http_code}' "$PROXY/res/perspective/app.js" 2>/dev/null)
[ "$code" = "200" ] && pass "absolute asset /res/perspective/app.js → 200" || fail "absolute asset → $code (expected 200)"

# 3) WebSocket upgrade forwarded → 101.
ws=$(curl -sS -m6 -i -N \
      -H "Connection: Upgrade" -H "Upgrade: websocket" \
      -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" -H "Sec-WebSocket-Version: 13" \
      "$PROXY/data/perspective/ws" 2>/dev/null | head -1)
echo "$ws" | grep -qi "101" && pass "WebSocket upgrade → 101" || fail "WebSocket upgrade not 101 (got: ${ws:-none})"

echo "== result =="
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; exit 0; else echo "$fails FAILED"; exit 1; fi
