#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_charlie.sh
# Run the Reddit → Telegram pipeline on Charlie node using Doppler for secrets.
#
# Usage:
#   chmod +x run_charlie.sh
#   ./run_charlie.sh                   # normal run
#   ./run_charlie.sh --dry-run         # dry run, no Telegram send
#   ./run_charlie.sh --scrape-only     # only scrape + export CSV
#   ./run_charlie.sh --limit 25        # forward top 25 posts only
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Reddit → Telegram Pipeline  |  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════"

# Doppler is required — no .env fallback
if ! command -v doppler &>/dev/null; then
    echo "  [error] Doppler CLI not found. Install: brew install dopplerhq/cli/doppler"
    exit 1
fi

echo "  [doppler] Loading secrets..."
echo "  [python]  Starting pipeline..."

cd "$SCRIPT_DIR"
doppler run --project factorylm --config prd -- \
    uv run --project "$REPO_ROOT" python main.py "$@"

echo ""
echo "  Done at $(date '+%H:%M:%S')"
echo "═══════════════════════════════════════════════════"
