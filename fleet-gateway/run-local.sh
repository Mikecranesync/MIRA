#!/bin/bash
# Start Fleet Gateway on 127.0.0.1:8765. Sources .env without printing values.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "ERROR: fleet-gateway/.env is missing" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
export PYTHONPATH="$(pwd)"
exec python3 -m fleet_gateway
