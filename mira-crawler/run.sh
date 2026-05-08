#!/usr/bin/env bash
# Doppler-injected env wrapper for mira-crawler (host / launchd)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# launchd plists set a minimal PATH that omits Homebrew. doppler is at
# /opt/homebrew/bin on Apple Silicon and /usr/local/bin on Intel, so include
# both. Without this, launchd restart after reboot fails with "doppler: not
# found" — the failure mode that left mira-crawler offline silently in the
# first place.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

DOPPLER_BIN="$(command -v doppler || true)"
if [ -z "$DOPPLER_BIN" ]; then
  echo "$(date -u +%FT%TZ) [run.sh] FATAL: doppler not found on PATH ($PATH)" >&2
  exit 127
fi

export CRAWLER_CACHE_DIR="$SCRIPT_DIR/data/cache"
export DEDUP_DB_PATH="$SCRIPT_DIR/data/crawler_dedup.db"
export INCOMING_WATCH_DIR="$SCRIPT_DIR/data/incoming"
export OLLAMA_BASE_URL="http://localhost:11434"

exec "$DOPPLER_BIN" run --project factorylm --config prd -- \
  .venv/bin/python main.py "$@"
