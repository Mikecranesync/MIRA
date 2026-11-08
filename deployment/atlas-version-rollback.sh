#!/usr/bin/env bash
# Atlas version rollback (#5188). Restores the database and compose file that a
# deploy-atlas apply saved in /opt/mira-cmms/backups/<stamp>/ before upgrading.
#
#   sudo bash /opt/mira-cmms/atlas-version-rollback.sh <stamp>
#
# Order is deliberate: validate the backup completely, stop only the app
# containers (cmms-db keeps running), restore into a scratch database, verify it,
# and only then swap it in and start the previous version. Any failure before the
# swap leaves the current database untouched.
set -euo pipefail

STAMP="${1:-}"
[ -n "$STAMP" ] || { echo "usage: sudo bash $0 <stamp>   (ls /opt/mira-cmms/backups)"; exit 2; }
# Overrides exist only so the procedure can be rehearsed off-host (see PR #5196).
ATLAS_HOME="${ATLAS_HOME:-/opt/mira-cmms}"
MIRA_HOME="${MIRA_HOME:-/opt/mira}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8088/health-check}"
[ "$(id -u)" = 0 ] || [ -n "${ATLAS_ROLLBACK_ALLOW_NONROOT:-}" ] || { echo "run as root (sudo bash $0 $STAMP)"; exit 2; }
case "$STAMP" in */*|*..*) echo "invalid stamp"; exit 2 ;; esac

BK="${ATLAS_HOME}/backups/${STAMP}"
DUMP="$BK/atlas.sql.gz"
OLD_COMPOSE="$BK/docker-compose.prod.yml"
LIVE_COMPOSE="${ATLAS_HOME}/docker-compose.prod.yml"

echo "=== 1. validate backup $BK ==="
[ -r "$DUMP" ] || { echo "no readable dump at $DUMP"; exit 1; }
[ -r "$OLD_COMPOSE" ] || { echo "no previous compose file at $OLD_COMPOSE"; exit 1; }
gzip -t "$DUMP"
TABLES="$(gunzip -c "$DUMP" | grep -c '^CREATE TABLE' || true)"
[ "${TABLES:-0}" -gt 0 ] || { echo "dump has no tables — refusing"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx cmms-db || { echo "cmms-db is not running — start it first, nothing changed"; exit 1; }
echo "backup OK: ${TABLES} tables"

compose() { (cd "$MIRA_HOME" && doppler run --project factorylm --config prd -- docker compose -p factorylm-cmms -f "$1" "${@:2}"); }
psql_db() { docker exec -i cmms-db sh -c "psql -q -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $1"; }

echo "=== 2. restore into scratch database atlas_rollback (live data untouched) ==="
docker exec cmms-db sh -c 'dropdb --if-exists -U "$POSTGRES_USER" atlas_rollback && createdb -U "$POSTGRES_USER" atlas_rollback'
gunzip -c "$DUMP" | psql_db atlas_rollback
RESTORED="$(docker exec cmms-db sh -c "psql -At -U \"\$POSTGRES_USER\" -d atlas_rollback -c \"select count(*) from information_schema.tables where table_schema='public'\"")"
[ "${RESTORED:-0}" -gt 0 ] || { echo "scratch restore has no tables — refusing, live data untouched"; exit 1; }
echo "scratch restore OK: ${RESTORED} tables"

echo "=== 3. stop the app, swap databases, install the previous compose file ==="
compose "$LIVE_COMPOSE" stop cmms-frontend cmms-backend
docker exec cmms-db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO atlas_before_rollback_'"$(date -u +%Y%m%d%H%M%S)"'" -c "ALTER DATABASE atlas_rollback RENAME TO \"$POSTGRES_DB\""'
install -m 644 "$OLD_COMPOSE" "$LIVE_COMPOSE"

echo "=== 4. start the previous version ==="
compose "$LIVE_COMPOSE" up -d --pull never
for _ in $(seq 1 60); do
  curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && { echo "ROLLBACK OK: backend healthy on the previous version"; exit 0; }
  sleep 5
done
echo "backend not healthy after 5 min — the upgraded database is kept as atlas_before_rollback_* for diagnosis"
exit 1
