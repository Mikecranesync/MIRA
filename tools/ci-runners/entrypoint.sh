#!/usr/bin/env bash
# Register ONE ephemeral runner, take exactly one job, exit. The container is started with
# --rm, so every job gets a clean filesystem. The only credential inside the container is a
# short-lived (1 hour) registration token, never a GitHub PAT or a Doppler token.
set -euo pipefail
: "${REPO_URL:?}" "${RUNNER_TOKEN:?}" "${RUNNER_NAME:?}" "${RUNNER_LABELS:?}"
cd /home/runner
./config.sh --unattended --ephemeral --replace --disableupdate \
  --url "$REPO_URL" --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --work _work
unset RUNNER_TOKEN
exec ./run.sh
