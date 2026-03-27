#!/usr/bin/env bash
# Doppler-injected env wrapper for mira-crawler (host / launchd)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export CRAWLER_CACHE_DIR="$SCRIPT_DIR/data/cache"
export DEDUP_DB_PATH="$SCRIPT_DIR/data/crawler_dedup.db"
export INCOMING_WATCH_DIR="$SCRIPT_DIR/data/incoming"
export OLLAMA_BASE_URL="http://localhost:11434"

exec /usr/local/bin/doppler run --project factorylm --config prd -- \
  .venv/bin/python main.py "$@"
