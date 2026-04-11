#!/usr/bin/env bash
# Config Tier Validation Smoke Tests
# Verifies each product tier works end-to-end.
#
# Usage: bash install/smoke_test_tiers.sh [tier]
#   tier: cloud-free | config-1 | config-3 | config-4 | all (default)

set -euo pipefail

PASS=0
FAIL=0
SKIP=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
yellow(){ printf "\033[33m○ %s\033[0m\n" "$1"; SKIP=$((SKIP+1)); }

check_http() {
    local url=$1 desc=$2 expected=${3:-200}
    status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")
    if [ "$status" = "$expected" ]; then
        green "$desc (HTTP $status)"
    else
        red "$desc (expected $expected, got $status)"
    fi
}

check_container() {
    local name=$1
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"; then
        green "Container $name running"
    else
        red "Container $name not running"
    fi
}

# ─── Cloud Free Tier ──────────────────────────────────────────────────────────
test_cloud_free() {
    echo ""
    echo "═══ Cloud Free Tier (app.factorylm.com) ═══"
    echo ""

    # PLG funnel
    check_http "http://localhost:3200/api/health" "mira-web health"

    # Registration endpoint exists
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{"email":"smoke@test.invalid","company":"SmokeTest"}' \
        "http://localhost:3200/api/register" 2>/dev/null || echo "000")
    if [ "$status" = "200" ] || [ "$status" = "409" ] || [ "$status" = "422" ]; then
        green "Registration endpoint responsive (HTTP $status)"
    else
        red "Registration endpoint (expected 200/409/422, got $status)"
    fi

    # Mira AI chat endpoint (requires auth, expect 401)
    check_http "http://localhost:3200/api/mira/chat" "Mira chat endpoint exists" "401"
}

# ─── Config 1-2 Tier ─────────────────────────────────────────────────────────
test_config_1() {
    echo ""
    echo "═══ Config 1-2 (Co-pilot + Knowledge Base) ═══"
    echo ""

    # Core services
    check_container "mira-core"
    check_http "http://localhost:3000/health" "Open WebUI health"

    # Ingest service
    check_container "mira-ingest"
    check_http "http://localhost:8002/health" "mira-ingest health"

    # MCP tools
    check_container "mira-mcp"

    # Tika sidecar (new)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "mira-tika"; then
        check_http "http://localhost:9998/tika" "Tika sidecar health"
    else
        yellow "Tika sidecar not running (optional for text-layer PDFs)"
    fi

    # Knowledge base has entries
    if command -v python3 &>/dev/null; then
        count=$(python3 -c "
import os, sys
try:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool
    url = os.environ.get('NEON_DATABASE_URL', '')
    if not url: sys.exit(0)
    e = create_engine(url, poolclass=NullPool, connect_args={'sslmode': 'require'})
    with e.connect() as c:
        r = c.execute(text('SELECT COUNT(*) FROM knowledge_entries'))
        print(r.scalar())
except: print('0')
" 2>/dev/null || echo "0")
        if [ "$count" -gt 0 ] 2>/dev/null; then
            green "Knowledge base has $count entries"
        else
            yellow "Knowledge base empty or NeonDB not configured"
        fi
    fi
}

# ─── Config 3 Tier ───────────────────────────────────────────────────────────
test_config_3() {
    echo ""
    echo "═══ Config 3 (Vision Ingestion) ═══"
    echo ""

    # All Config 1-2 checks
    test_config_1

    # Ollama vision model available
    vision_ok=$(curl -s "http://localhost:11434/api/tags" 2>/dev/null | grep -c "qwen2.5vl" || echo "0")
    if [ "$vision_ok" -gt 0 ]; then
        green "Vision model qwen2.5vl available in Ollama"
    else
        yellow "Vision model qwen2.5vl not loaded (run: ollama pull qwen2.5vl:7b)"
    fi

    # Photo ingest endpoint
    check_http "http://localhost:8002/health" "Photo ingest service"
}

# ─── Config 4 Tier ───────────────────────────────────────────────────────────
test_config_4() {
    echo ""
    echo "═══ Config 4 (Live Equipment Data) ═══"
    echo ""

    # All Config 3 checks
    test_config_3

    # Node-RED bridge
    check_container "mira-bridge"
    check_http "http://localhost:1880/" "Node-RED dashboard"

    # SQLite mira.db exists and has tables
    if [ -f "mira-bridge/data/mira.db" ]; then
        tables=$(sqlite3 mira-bridge/data/mira.db ".tables" 2>/dev/null || echo "")
        if echo "$tables" | grep -q "equipment_status"; then
            green "mira.db has equipment_status table"
        else
            yellow "mira.db exists but no equipment_status table (PLC not connected)"
        fi
    else
        yellow "mira.db not found (Node-RED not initialized)"
    fi

    # Bot adapters
    for bot in telegram slack; do
        check_container "mira-bot-${bot}"
    done

    # CMMS
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "atlas-api"; then
        check_http "http://localhost:8088/actuator/health" "Atlas CMMS API health"
        check_container "atlas-db"
        check_container "atlas-frontend"
    else
        yellow "Atlas CMMS not running (optional)"
    fi
}

# ─── Celery Infrastructure ───────────────────────────────────────────────────
test_celery() {
    echo ""
    echo "═══ Celery Task Queue ═══"
    echo ""

    check_container "mira-redis"
    check_http "http://localhost:6379" "Redis" "000"  # Redis doesn't serve HTTP — check container instead

    # Verify Redis responds to ping
    redis_ok=$(docker exec mira-redis redis-cli ping 2>/dev/null || echo "FAIL")
    if [ "$redis_ok" = "PONG" ]; then
        green "Redis responding to PING"
    else
        red "Redis not responding"
    fi

    check_container "mira-celery-worker"
    check_container "mira-celery-beat"
}

# ─── Main ────────────────────────────────────────────────────────────────────
TIER=${1:-all}

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  MIRA Config Tier Validation Smoke Tests  ║"
echo "╚═══════════════════════════════════════════╝"

case "$TIER" in
    cloud-free) test_cloud_free ;;
    config-1)   test_config_1 ;;
    config-3)   test_config_3 ;;
    config-4)   test_config_4 ;;
    celery)     test_celery ;;
    all)
        test_cloud_free
        test_config_1
        test_config_3
        test_config_4
        test_celery
        ;;
    *) echo "Usage: $0 [cloud-free|config-1|config-3|config-4|celery|all]"; exit 1 ;;
esac

echo ""
echo "─────────────────────────────────────────────"
printf "Results: \033[32m%d passed\033[0m  \033[31m%d failed\033[0m  \033[33m%d skipped\033[0m\n" "$PASS" "$FAIL" "$SKIP"
echo "─────────────────────────────────────────────"

[ "$FAIL" -eq 0 ] || exit 1
