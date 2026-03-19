#!/usr/bin/env bash
# MIRA — Smoke Test
# Checks all 5 required endpoints.
# Exit code: 0 = all pass, 1 = one or more fail

set -uo pipefail

PASS=0
FAIL=0
RESULTS=()

check() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    if [ "$status" = "$expected_status" ]; then
        RESULTS+=("  ✅ $name ($url) → HTTP $status")
        PASS=$((PASS + 1))
    else
        RESULTS+=("  ❌ $name ($url) → HTTP $status (expected $expected_status)")
        FAIL=$((FAIL + 1))
    fi
}

echo "=== MIRA Smoke Test ==="
echo ""

check "open-webui"    "http://localhost:3000/health"
check "mira-ingest"   "http://localhost:8002/health"
check "mira-mcp"      "http://localhost:8001/health"
check "mira-mcpo"     "http://localhost:8003/mira-mcp/docs"
check "node-red"      "http://localhost:1880/"

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
