#!/usr/bin/env bash
# Keeps N ephemeral GitHub Actions runners alive on Bravo (Colima profile "gha").
# Runs under launchd (com.factorylm.gha-runners.plist). One loop per slot: start a container,
# it registers, runs ONE job, exits (--rm), loop starts a fresh one.
#
# Isolation (why there is no Docker socket, no host network, no shared folder):
#   A job that can reach the VM's Docker daemon can `docker exec` into sibling runner
#   containers, read their tokens, start a privileged container and own the VM, or leave a
#   container behind to watch later jobs. So runner containers get NOTHING from the VM: each
#   job is one unprivileged container with its own network namespace and filesystem. Jobs that
#   need Docker (services:, container:, compose, image builds, container actions) stay on
#   GitHub-hosted runners; tools/ci_runner_placement.py + tests/test_ci_runner_placement.py
#   enforce which jobs may select this pool.
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
SLOTS="${SLOTS:-5}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.gha/regtoken}"
LOG_DIR="$HOME/.gha/logs"
mkdir -p "$LOG_DIR"

slot() {
  local name="$1"
  while true; do
    if ! colima status gha >/dev/null 2>&1; then sleep 30; continue; fi
    local tok
    tok="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
    if [ -z "$tok" ]; then echo "$(date -u +%FT%TZ) $name no registration token yet" >>"$LOG_DIR/$name.log"; sleep 60; continue; fi
    docker run --rm --name "gha-$name" --network bridge \
      -e REPO_URL="$REPO_URL" -e RUNNER_TOKEN="$tok" \
      -e RUNNER_NAME="bravo-$name-$(date +%s)" -e RUNNER_LABELS="self-hosted,linux,arm64,mira-bravo" \
      "$IMAGE" >>"$LOG_DIR/$name.log" 2>&1
    echo "$(date -u +%FT%TZ) $name exited rc=$?" >>"$LOG_DIR/$name.log"
    sleep 3
  done
}

for i in $(seq 1 "$SLOTS"); do
  slot "gen-$i" &
done
wait
