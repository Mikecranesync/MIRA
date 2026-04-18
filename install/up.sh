#!/usr/bin/env bash
set -euo pipefail

# MIRA — Start all services
# Creates Docker networks if missing, then runs compose up

docker network create core-net 2>/dev/null || true
docker network create bot-net 2>/dev/null || true
docker network create cmms-net 2>/dev/null || true

# Ensure SQLite DB files exist so Docker doesn't create them as directories
mkdir -p mira-core/data/photos
[ -f mira-core/mira.db ] || touch mira-core/mira.db
mkdir -p mira-bridge/data
[ -f mira-bridge/data/mira.db ] || touch mira-bridge/data/mira.db

doppler run -- docker compose up -d "$@"
