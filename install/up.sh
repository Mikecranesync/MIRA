#!/usr/bin/env bash
set -euo pipefail

# MIRA — Start all services
# Creates Docker networks if missing, then runs compose up

docker network create core-net 2>/dev/null || true
docker network create bot-net 2>/dev/null || true

doppler run -- docker compose up -d "$@"
