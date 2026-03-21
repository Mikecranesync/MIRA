#!/usr/bin/env bash
# MIRA — Smoke Test
# Checks all 5 required endpoints.
# Set MIRA_SERVER_BASE_URL to test against a remote server (e.g. http://192.168.1.11)
# Exit code: 0 = all pass, 1 = one or more fail
#
# Set MIRA_SERVER_BASE_URL for remote testing, e.g.:
#   MIRA_SERVER_BASE_URL=http://100.86.236.11 ./smoke_test.sh
# Defaults to http://localhost when unset.

set -uo pipefail

BASE="${MIRA_SERVER_BASE_URL:-http://localhost}"

PASS=0
FAIL=0
RESULTS=()

check() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [ "$status" = "$expected_status" ]; then
        RESULTS+=("  PASS $name ($url) -> HTTP $status")
        PASS=$((PASS + 1))
    else
        RESULTS+=("  FAIL $name ($url) -> HTTP $status (expected $expected_status)")
        FAIL=$((FAIL + 1))
    fi
}

echo "=== MIRA Smoke Test ==="
echo "Base URL: $BASE"
echo ""

check "open-webui"       "${BASE}:3000/health"
check "mira-ingest"      "${BASE}:8002/health"
check "mira-mcp"         "${BASE}:8001/health"
check "mira-mcpo"        "${BASE}:8003/mira-mcp/docs"
check "node-red"         "${BASE}:1880/"
check "test-runner-results" "${BASE}:8021/results" "503"  # 503 = running, no results yet

echo "Results:"
for r in "${RESULTS[@]}"; do
    echo "$r"
done

echo ""
echo "Passed: $PASS / $((PASS + FAIL))"

if [ "$FAIL" -eq 0 ]; then
    echo "✅ All smoke tests PASSED"
    exit 0
else
    echo "❌ $FAIL smoke test(s) FAILED"
    exit 1
fi
