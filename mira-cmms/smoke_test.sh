#!/usr/bin/env bash
set -euo pipefail

# Atlas CMMS — Smoke test
# Validates all 4 containers are healthy and API responds

echo "=== Atlas CMMS Smoke Test ==="

ATLAS_API_URL="${ATLAS_PUBLIC_API_URL:-http://localhost:8088}"
ATLAS_FRONTEND_URL="${ATLAS_PUBLIC_FRONT_URL:-http://localhost:3100}"

fail=0

# 1. Check containers running
echo -n "1. atlas-db container...       "
if docker inspect --format='{{.State.Status}}' atlas-db 2>/dev/null | grep -q running; then
    echo "OK"
else
    echo "FAIL" && fail=1
fi

echo -n "2. atlas-minio container...    "
if docker inspect --format='{{.State.Status}}' atlas-minio 2>/dev/null | grep -q running; then
    echo "OK"
else
    echo "FAIL" && fail=1
fi

echo -n "3. atlas-api container...      "
if docker inspect --format='{{.State.Status}}' atlas-api 2>/dev/null | grep -q running; then
    echo "OK"
else
    echo "FAIL" && fail=1
fi

echo -n "4. atlas-frontend container... "
if docker inspect --format='{{.State.Status}}' atlas-frontend 2>/dev/null | grep -q running; then
    echo "OK"
else
    echo "FAIL" && fail=1
fi

# 2. Check API health
echo -n "5. Atlas API health...         "
if curl -sf "${ATLAS_API_URL}/actuator/health" > /dev/null 2>&1; then
    echo "OK"
else
    echo "FAIL (${ATLAS_API_URL}/actuator/health)" && fail=1
fi

# 3. Check frontend serves HTML
echo -n "6. Atlas frontend serves UI... "
if curl -sf "${ATLAS_FRONTEND_URL}/" > /dev/null 2>&1; then
    echo "OK"
else
    echo "FAIL (${ATLAS_FRONTEND_URL}/)" && fail=1
fi

# 4. Check PostgreSQL accepts connections
echo -n "7. PostgreSQL accepts conn...  "
if docker exec atlas-db pg_isready -U "${ATLAS_DB_USER:-atlas}" -d atlas > /dev/null 2>&1; then
    echo "OK"
else
    echo "FAIL" && fail=1
fi

echo ""
if [ "$fail" -eq 0 ]; then
    echo "All checks passed. Atlas CMMS is ready at ${ATLAS_FRONTEND_URL}"
else
    echo "Some checks failed. Run 'docker compose logs atlas-api' for details."
    exit 1
fi
