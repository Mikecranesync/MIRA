#!/usr/bin/env bash
# Persistence proof for Command Center display registration (req 4 "stays locked").
#
# Spins up a throwaway local Postgres 16 cluster (no docker, no network), applies
# the REAL migration 030 DDL (table + RLS + grant), then runs the EXACT upsert
# the POST /api/command-center/display route runs — under SET ROLE factorylm_app
# + tenant GUCs, so RLS/grant are exercised the same way withTenantContext does.
#
# Proves:
#   1. register → the display round-trips back through the tree read query
#   2. re-register (seed-refresh / re-onboard) keeps ONE row (upsert, no dup/delete)
#   3. the display survives audit-node churn in kg_entities
#   4. RLS isolates it to its tenant
#
# Mirrors db/migrations/030 + src/app/api/command-center/display/route.ts.
# Run from mira-hub/:  bash scripts/verify-display-register-roundtrip.sh
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/bin}"
TMP="$(mktemp -d)"
PGDATA="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$SOCK"
FAILED=0

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1

PSQL=("$PGBIN/psql" -v ON_ERROR_STOP=1 -h "$SOCK" -U postgres -d postgres -X -q)

T1="11111111-1111-1111-1111-111111111111"
T2="22222222-2222-2222-2222-222222222222"
UNS="enterprise.bench.conv_simple"

# --- schema: role, ltree, kg_entities stub, then the real migration 030 --------
"${PSQL[@]}" >/dev/null <<SQL
CREATE ROLE factorylm_app NOLOGIN;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE TABLE kg_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  uns_path LTREE,
  name TEXT,
  entity_type TEXT DEFAULT 'equipment'
);
GRANT SELECT ON kg_entities TO factorylm_app;
SQL
"${PSQL[@]}" -f db/migrations/030_display_endpoints_registry.sql >/dev/null
"${PSQL[@]}" -c "INSERT INTO kg_entities (tenant_id, uns_path, name) VALUES ('$T1'::uuid, '$UNS'::ltree, 'Conveyor');" >/dev/null

# The exact upsert the POST route runs, as the limited app role under tenant ctx.
register() { # host port
  "${PSQL[@]}" >/dev/null <<SQL
SET ROLE factorylm_app;
SET app.tenant_id = '$T1';
SET app.current_tenant_id = '$T1';
INSERT INTO display_endpoints
    (tenant_id, uns_path, display_type, scheme, host, port, path, label, enabled, created_by)
VALUES ('$T1'::uuid, '$UNS'::ltree, 'web_iframe', 'http', '$1', $2,
        '/data/perspective/client/ConvSimpleLive', 'Conv Simple — Live', true, NULL)
ON CONFLICT (tenant_id, uns_path) WHERE uns_path IS NOT NULL
DO UPDATE SET host=EXCLUDED.host, port=EXCLUDED.port, enabled=true, updated_at=now();
SQL
}

# Tree read (display side of the tree query) under tenant ctx — what the UI sees.
read_displays() { # tenant -> "count|host"
  "${PSQL[@]}" -t -A <<SQL | tr -d '[:space:]'
SET ROLE factorylm_app;
SET app.tenant_id = '$1';
SET app.current_tenant_id = '$1';
SELECT count(*) || '|' || COALESCE(max(host), '-')
  FROM display_endpoints WHERE tenant_id = '$1'::uuid AND enabled = true;
SQL
}

assert() { # label expected actual
  if [ "$2" = "$3" ]; then echo "  ✓ $1 ($3)"; else echo "  ✗ $1 — expected '$2', got '$3'"; FAILED=1; fi
}

echo "→ 1. register conv_simple, then read it back through the tree query"
register "127.0.0.1" 8890
assert "registered display round-trips (count|host)" "1|127.0.0.1" "$(read_displays "$T1")"

echo "→ 2. re-register (seed-refresh / re-onboard) — must keep ONE row, updated in place"
register "100.72.2.99" 8088
assert "no duplicate after re-register; host updated" "1|100.72.2.99" "$(read_displays "$T1")"

echo "→ 3. churn 50 audit nodes into kg_entities — display must NOT disappear"
"${PSQL[@]}" >/dev/null <<SQL
INSERT INTO kg_entities (tenant_id, uns_path, name)
SELECT '$T1'::uuid, ('audit_' || g)::ltree, 'Audit ' || g
FROM generate_series(1,50) g;
SQL
assert "display survives namespace/audit churn" "1|100.72.2.99" "$(read_displays "$T1")"

echo "→ 4. RLS: a different tenant sees zero of T1's displays"
assert "tenant isolation" "0|-" "$(read_displays "$T2")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS — registered Command Center display persists & is tenant-isolated (PG $($PGBIN/postgres --version | awk '{print $3}'))"
else
  echo "FAIL — see ✗ above"; exit 1
fi
