#!/usr/bin/env bash
set -uo pipefail
BASE="http://localhost:${MCPO_PORT:-8000}"
KEY="${MCPO_API_KEY:?"Error: MCPO_API_KEY not set. Export before running."}"
AUTH="Authorization: Bearer $KEY"
PASS=0; FAIL=0

check() {
  local desc="$1"; local result="$2"
  if [ "$result" = "true" ]; then
    echo "✅ $desc"; ((PASS++))
  else
    echo "❌ $desc"; ((FAIL++))
  fi
}

# 1. OpenAPI docs reachable
DOCS=$(curl -sf -o /dev/null -H "$AUTH" "$BASE/mira-mcp/docs" && echo true || echo false)
check "OpenAPI docs reachable" "$DOCS"

# 2. All 4 tool names present in spec
SPEC=$(curl -sf -H "$AUTH" "$BASE/mira-mcp/openapi.json" || echo "{}")
for tool in get_equipment_status list_active_faults get_fault_history get_maintenance_notes; do
  HAS=$(echo "$SPEC" | grep -q "$tool" && echo true || echo false)
  check "Tool present: $tool" "$HAS"
done

# 3. list_active_faults returns COMP-001
FAULTS=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" \
  -d '{}' "$BASE/mira-mcp/list_active_faults" || echo "{}")
HAS_COMP=$(echo "$FAULTS" | grep -q "COMP-001" && echo true || echo false)
check "list_active_faults contains COMP-001" "$HAS_COMP"

# 4. get_equipment_status for PUMP-001 returns running
STATUS=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"equipment_id":"PUMP-001"}' "$BASE/mira-mcp/get_equipment_status" || echo "{}")
IS_RUNNING=$(echo "$STATUS" | grep -qi "running" && echo true || echo false)
check "PUMP-001 status is running" "$IS_RUNNING"

# 5. get_maintenance_notes returns data
NOTES=$(curl -sf -H "$AUTH" -H "Content-Type: application/json" \
  -d '{}' "$BASE/mira-mcp/get_maintenance_notes" || echo "[]")
HAS_NOTES=$(echo "$NOTES" | grep -q "COMP-001" && echo true || echo false)
check "get_maintenance_notes returns data" "$HAS_NOTES"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
