#!/usr/bin/env bash
# backup.sh [ssh-host] [local-dir] — dump the tablet's local database and hub.env, then copy
# the backup to this machine and verify its checksum. Projects, machines, manuals and photos
# (file bytes are stored in the database), jobs, notes and chat history are all in the dump.
# The backup holds customer data and the device's AUTH_SECRET: keep it on encrypted storage
# the customer controls, never in a repository.
set -euo pipefail
HOST=${1:-tab}
DEST=${2:-./edge-backups}
NAME=mira-edge-$(date -u +%Y%m%dT%H%M%SZ)
ssh "$HOST" "NAME=$NAME bash -s" <<'REMOTE'
set -euo pipefail
. ~/hub.env
B=~/mira-edge/backups
mkdir -p "$B/$NAME"
pg_dump "$NEON_DATABASE_URL" -Fc -f "$B/$NAME/db.dump"
cp ~/hub.env "$B/$NAME/hub.env"
head -1 ~/hub/BUILD_SHA > "$B/$NAME/BUILD_SHA"
psql "$NEON_DATABASE_URL" -At -F' ' -c "select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by relname" > "$B/$NAME/row-counts.txt"
(cd "$B" && tar -czf "$NAME.tgz" "$NAME" && rm -rf "$NAME" && sha256sum "$NAME.tgz" > "$NAME.tgz.sha256")
REMOTE
mkdir -p "$DEST"
scp -q "$HOST:mira-edge/backups/$NAME.tgz" "$HOST:mira-edge/backups/$NAME.tgz.sha256" "$DEST/"
(cd "$DEST" && shasum -a 256 -c "$NAME.tgz.sha256")
echo "$DEST/$NAME.tgz"
