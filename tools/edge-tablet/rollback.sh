#!/usr/bin/env bash
# rollback.sh [ssh-host] — point the tablet back at the previous release and restart.
# The database is NOT rolled back (restore.sh does that); all releases share one database.
set -euo pipefail
HOST=${1:-tab}
ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
P=$(cat ~/mira-edge/previous 2>/dev/null || true)
[ -n "$P" ] && [ -d "$P" ] || { echo "no previous release recorded"; exit 1; }
CUR=$(readlink ~/hub)
ln -sfn "$P" ~/hub
echo "$CUR" > ~/mira-edge/previous
sed -i "s/^export MIRA_GIT_SHA=.*/export MIRA_GIT_SHA=$(head -1 "$P/BUILD_SHA")/" ~/hub.env
~/hubctl.sh restart
sleep 8
~/hubctl.sh status
REMOTE
