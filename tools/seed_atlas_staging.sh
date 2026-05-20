#!/usr/bin/env bash
# Seed stg-atlas-* with admin + company + locations + assets + 5 demo PMs.
# Idempotent — safe to re-run; skips anything that already exists.
#
# Usage (run on the VPS):
#   ssh root@165.245.138.91 'cd /opt/mira-staging && doppler run --project factorylm --config stg -- bash tools/seed_atlas_staging.sh'
#
# Required env (injected by doppler factorylm/stg):
#   ATLAS_API_USER       — admin email to create / sign in as
#   ATLAS_API_PASSWORD   — admin password (must already be in Doppler)
#   ATLAS_DB_PASSWORD    — Postgres password for the SQL leg

set -euo pipefail

ATLAS_API="${ATLAS_API_BASE:-http://127.0.0.1:4088}"
ADMIN_EMAIL="${ATLAS_API_USER:?ATLAS_API_USER required (Doppler factorylm/stg)}"
ADMIN_PASSWORD="${ATLAS_API_PASSWORD:?ATLAS_API_PASSWORD required}"
COMPANY_NAME="${ATLAS_SEED_COMPANY:-FactoryLM Staging}"

# ─── 0. Wait for atlas-api healthy ────────────────────────────────────────
echo "[seed] waiting for atlas-api at $ATLAS_API"
for i in {1..60}; do
  if curl -fsS "$ATLAS_API/" >/dev/null 2>&1; then
    echo "[seed] atlas-api reachable after ${i}s"
    break
  fi
  sleep 2
  if [ "$i" = "60" ]; then
    echo "[seed] ERROR atlas-api never became reachable" >&2
    exit 1
  fi
done

# ─── 1. Sign up admin (first user = admin in Atlas). Idempotent. ──────────
echo "[seed] signup: $ADMIN_EMAIL"
SIGNUP_RESP=$(curl -sS -w "\n%{http_code}" -X POST "$ATLAS_API/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"firstName\":\"Mike\",\"lastName\":\"Harper\",\"companyName\":\"$COMPANY_NAME\"}" \
  || true)
SIGNUP_CODE=$(echo "$SIGNUP_RESP" | tail -1)
case "$SIGNUP_CODE" in
  200|201) echo "[seed] admin created" ;;
  409|400) echo "[seed] admin already exists (HTTP $SIGNUP_CODE) — proceeding to sign-in" ;;
  *)       echo "[seed] WARN signup returned HTTP $SIGNUP_CODE — attempting sign-in anyway" ;;
esac

# ─── 2. Sign in → JWT ─────────────────────────────────────────────────────
echo "[seed] signin"
JWT=$(curl -fsS -X POST "$ATLAS_API/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -z "$JWT" ]; then
  echo "[seed] ERROR could not obtain JWT" >&2
  exit 1
fi
echo "[seed] got JWT (${#JWT} chars)"
AUTH="Authorization: Bearer $JWT"

# ─── 3. Create locations (skip if existing). ──────────────────────────────
create_location() {
  local name="$1"
  local exists
  exists=$(curl -fsS "$ATLAS_API/api/locations" -H "$AUTH" \
    | grep -c "\"name\":\"$name\"" || true)
  if [ "$exists" -gt 0 ]; then
    echo "[seed] location '$name' exists — skip"
    return
  fi
  curl -fsS -X POST "$ATLAS_API/api/locations" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"address\":\"$name\"}" >/dev/null
  echo "[seed] location created: $name"
}
create_location "Main Plant"
create_location "Maintenance Shop"

# ─── 4. Create asset categories. ──────────────────────────────────────────
create_category() {
  local name="$1"
  local exists
  exists=$(curl -fsS "$ATLAS_API/api/categories?type=ASSET" -H "$AUTH" \
    | grep -c "\"name\":\"$name\"" || true)
  if [ "$exists" -gt 0 ]; then
    echo "[seed] category '$name' exists — skip"
    return
  fi
  curl -fsS -X POST "$ATLAS_API/api/categories" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"type\":\"ASSET\"}" >/dev/null
  echo "[seed] category created: $name"
}
create_category "Air Compressor"
create_category "VFD"
create_category "Conveyor"

# ─── 5. Create assets matching seed_atlas_pms.sql IDs (1,2,3,5). ──────────
create_asset() {
  local name="$1"
  local exists
  exists=$(curl -fsS "$ATLAS_API/api/assets?search=$(echo "$name" | sed 's/ /%20/g')" -H "$AUTH" \
    | grep -c "\"name\":\"$name\"" || true)
  if [ "$exists" -gt 0 ]; then
    echo "[seed] asset '$name' exists — skip"
    return
  fi
  curl -fsS -X POST "$ATLAS_API/api/assets" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"status\":\"OPERATIONAL\"}" >/dev/null
  echo "[seed] asset created: $name"
}
create_asset "Air Compressor #1"
create_asset "PowerFlex 525 VFD"
create_asset "Yaskawa GA500"
create_asset "SINAMICS G120"
create_asset "Conveyor #3"

# ─── 6. Apply PM seed SQL (atlas-db). ─────────────────────────────────────
SEED_SQL="tools/seed_atlas_pms.sql"
if [ ! -f "$SEED_SQL" ]; then
  echo "[seed] $SEED_SQL not found — skipping PM seed" >&2
  exit 0
fi
echo "[seed] applying $SEED_SQL"
docker exec -i stg-atlas-db \
  psql -U "${ATLAS_DB_USER:-atlas}" -d atlas < "$SEED_SQL"

# ─── 7. Verify ────────────────────────────────────────────────────────────
echo "[seed] verify — work-order endpoint:"
curl -sS "$ATLAS_API/api/preventive-maintenances" -H "$AUTH" \
  | grep -o '"title":"[^"]*"' | head -10

echo "[seed] DONE"
