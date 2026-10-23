#!/usr/bin/env bash
# Keeps N ephemeral GitHub Actions runners alive on Bravo (Colima profile "gha").
# Runs under launchd (com.factorylm.gha-runners.plist). One loop per slot: start a container,
# it registers, runs ONE job, exits (--rm), loop starts a fresh one.
#
# Slots:
#   gen-1..gen-$GENERAL_SLOTS  labels: self-hosted,linux,arm64,mira-bravo
#       own network namespace per container, so jobs that start servers on fixed ports
#       (Next on :3000, uvicorn on :8000, ...) can run side by side without colliding.
#   svc-1                      labels: self-hosted,linux,arm64,mira-bravo-services
#       --network host: for workflows with `services:` or `docker compose up` that reach those
#       containers on localhost. Exactly one slot, so fixed service ports can't collide.
#
# The only credential a container sees is the 1-hour registration token that CHARLIE writes
# to $TOKEN_FILE (tools/ci-runners/charlie-regtoken-refresh.sh). No PAT, no Doppler token.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.colima/gha/docker.sock"
# Own docker config: Bravo's ~/.docker points at a Docker Desktop credential helper that is not installed.
export DOCKER_CONFIG="$HOME/.gha/docker-config"
mkdir -p "$DOCKER_CONFIG"; [ -f "$DOCKER_CONFIG/config.json" ] || echo "{}" >"$DOCKER_CONFIG/config.json"

REPO_URL="${REPO_URL:?set REPO_URL, e.g. https://github.com/Mikecranesync/MIRA}"
IMAGE="${IMAGE:-mira-gha-runner:2.338.1}"
GENERAL_SLOTS="${GENERAL_SLOTS:-4}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.gha/regtoken}"
LOG_DIR="$HOME/.gha/logs"
mkdir -p "$LOG_DIR"

sock_gid() { docker run --rm -v /var/run/docker.sock:/s alpine:3.20 stat -c %g /s 2>/dev/null || echo 0; }

slot() {
  local name="$1" labels="$2" net="$3"
  while true; do
    if ! colima status gha >/dev/null 2>&1; then sleep 30; continue; fi
    local tok gid
    tok="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
    if [ -z "$tok" ]; then echo "$(date -u +%FT%TZ) $name no registration token yet" >>"$LOG_DIR/$name.log"; sleep 60; continue; fi
    gid="$(sock_gid)"
    # Job folder at the SAME path in the VM and in the runner container (and under the runner's
    # home, which SARIF upload requires): container actions
    # (docker://...) and `docker run -v $PWD:...` in jobs bind-mount VM paths, so the job's files
    # must exist there too. Wiped before every job (ephemeral). uid 1001 = runner user.
    local work="/home/runner/gha-work/$name"
    docker run --rm -v /home/runner/gha-work:/w alpine:3.20 sh -c "rm -rf /w/$name && mkdir -p /w/$name && chown 1001:1001 /w/$name" >/dev/null 2>&1
    docker run --rm --name "gha-$name" --network "$net" --group-add "$gid" \
      -v /var/run/docker.sock:/var/run/docker.sock -v "$work:$work" -e RUNNER_WORKDIR="$work" \
      -e REPO_URL="$REPO_URL" -e RUNNER_TOKEN="$tok" \
      -e RUNNER_NAME="bravo-$name-$(date +%s)" -e RUNNER_LABELS="$labels" \
      "$IMAGE" >>"$LOG_DIR/$name.log" 2>&1
    echo "$(date -u +%FT%TZ) $name exited rc=$?" >>"$LOG_DIR/$name.log"
    sleep 3
  done
}

# Jobs pull/build images into the CI VM; nothing else removes them. Every 6 h drop unused
# images and build cache older than 3 days so the 100 GB VM disk does not fill.
prune() {
  while true; do
    docker image prune -af --filter "until=72h" --filter "label!=mira.keep=true" >>"$LOG_DIR/prune.log" 2>&1
    docker builder prune -af --filter "until=72h" >>"$LOG_DIR/prune.log" 2>&1
    sleep 21600
  done
}
prune &

for i in $(seq 1 "$GENERAL_SLOTS"); do
  slot "gen-$i" "self-hosted,linux,arm64,mira-bravo" bridge &
done
slot "svc-1" "self-hosted,linux,arm64,mira-bravo-services" host &
wait
