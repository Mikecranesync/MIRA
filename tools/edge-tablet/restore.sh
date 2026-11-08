#!/usr/bin/env bash
# restore.sh <mira-edge-*.tgz> [ssh-host] [--into <db>] — restore a backup on the tablet.
# Default: the LIVE database. The Hub is stopped, the database restored with --clean, and the
# Hub restarted. With --into <db> the backup goes into a separate database and live data is
# not touched (use it to prove a backup restores before you need it).
set -euo pipefail
TGZ=${1:?usage: restore.sh mira-edge-<ts>.tgz [ssh-host] [--into db]}
HOST=${2:-tab}
INTO=
if [ "${3:-}" = "--into" ]; then INTO=${4:?--into needs a database name}; fi
case "$INTO" in *[!a-z0-9_]*) echo "database name: lowercase letters, digits, _ only" >&2; exit 2 ;; esac
NAME=$(basename "$TGZ" .tgz)
if [ -f "$TGZ.sha256" ]; then (cd "$(dirname "$TGZ")" && shasum -a 256 -c "$(basename "$TGZ").sha256"); fi
scp -q "$TGZ" "$HOST:mira-edge/$NAME.tgz"
ssh "$HOST" "NAME=$NAME INTO=$INTO bash -s" <<'REMOTE'
set -euo pipefail
. ~/hub.env
cd ~/mira-edge && tar -xzf "$NAME.tgz" && rm "$NAME.tgz"
if [ -n "$INTO" ]; then
  [ "$INTO" != mira_edge ] || { echo "--into must not name the live database"; exit 1; }
  BASE=${NEON_DATABASE_URL%%\?*}; BASE=${BASE%/*}; Q=${NEON_DATABASE_URL#*\?}
  psql "$NEON_DATABASE_URL" -Atc "drop database if exists $INTO"
  psql "$NEON_DATABASE_URL" -Atc "create database $INTO"
  pg_restore -d "$BASE/$INTO?$Q" --no-owner "$NAME/db.dump"
  psql "$BASE/$INTO?$Q" -At -F' ' -c "select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by relname" > "$NAME/restored-counts.txt" || true
  echo "restored into $INTO"
else
  ~/hubctl.sh stop
  pg_restore -d "$NEON_DATABASE_URL" --clean --if-exists --no-owner "$NAME/db.dump"
  ~/hubctl.sh start
  sleep 8
  ~/hubctl.sh status
fi
rm -rf ~/mira-edge/"$NAME"
REMOTE
