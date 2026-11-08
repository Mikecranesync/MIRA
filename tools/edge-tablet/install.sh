#!/usr/bin/env bash
# install.sh <edge-hub-*.tgz> [ssh-host] — install or update a release on the tablet. Keeps
# the previous release for rollback, restarts, and rolls back by itself if the new release
# does not answer the sign-in page within 60 s. The database is shared across releases.
# Run from the operator's machine; ssh-host defaults to "tab" (Termux sshd, port 8022).
set -euo pipefail
TGZ=${1:?usage: install.sh edge-hub-<sha12>.tgz [ssh-host]}
HOST=${2:-tab}
HERE=$(cd "$(dirname "$0")" && pwd)
if [ -f "$TGZ.sha256" ]; then (cd "$(dirname "$TGZ")" && shasum -a 256 -c "$(basename "$TGZ").sha256"); fi
NAME=$(basename "$TGZ" .tgz)
scp -q "$TGZ" "$HOST:$NAME.tgz"
scp -q "$HERE/hubctl.sh" "$HOST:hubctl.sh"
ssh "$HOST" "NAME=$NAME bash -s" <<'REMOTE'
set -euo pipefail
chmod +x ~/hubctl.sh
R=~/mira-edge/releases
mkdir -p "$R"
[ -f ~/hub.env ] || { echo "missing ~/hub.env: copy hub.env.example to ~/hub.env and fill it in first"; exit 1; }
# First install over a hand-made ~/hub directory: move it into releases so rollback can reach it.
if [ -d ~/hub ] && [ ! -L ~/hub ]; then
  OLD=$(head -1 ~/hub/BUILD_SHA 2>/dev/null || echo "legacy-$(date +%s)")
  mv ~/hub "$R/${OLD:0:12}"
  ln -s "$R/${OLD:0:12}" ~/hub
fi
NEW=$R/${NAME#edge-hub-}
rm -rf "$NEW.tmp" && mkdir -p "$NEW.tmp"
tar -C "$NEW.tmp" -xzf ~/"$NAME".tgz
rm -rf "$NEW" && mv "$NEW.tmp/hub" "$NEW" && rm -rf "$NEW.tmp" ~/"$NAME".tgz
PREV=$(readlink ~/hub 2>/dev/null || true)
if [ -n "$PREV" ] && [ "$PREV" != "$NEW" ]; then echo "$PREV" > ~/mira-edge/previous; fi
ln -sfn "$NEW" ~/hub
sed -i "s/^export MIRA_GIT_SHA=.*/export MIRA_GIT_SHA=$(head -1 "$NEW/BUILD_SHA")/" ~/hub.env
~/hubctl.sh restart
c=000
for _ in $(seq 1 60); do
  c=$(curl -s -L -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)
  [ "$c" = 200 ] && break
  sleep 1
done
~/hubctl.sh status
if [ "$c" != 200 ]; then
  echo "NEW RELEASE DID NOT ANSWER (sign-in page $c); rolling back"
  tail -20 ~/hub.log
  if [ -s ~/mira-edge/previous ]; then ln -sfn "$(cat ~/mira-edge/previous)" ~/hub && ~/hubctl.sh restart; fi
  exit 1
fi
# Keep the active release, the previous one and the newest other; delete older ones.
ls -1dt "$R"/*/ | tail -n +4 | while read -r d; do
  d=${d%/}
  [ "$d" = "$(readlink ~/hub)" ] || [ "$d" = "$(cat ~/mira-edge/previous 2>/dev/null)" ] || rm -rf "$d"
done
REMOTE
