#!/usr/bin/env bash
# publish-next.sh — produce + upload the NEXT video in the calendar queue,
# regardless of the 48h "last run was recent" guard. The complement to the
# launchd nightly job at 2 AM, which respects the guard.
#
# Usage:
#   ./tools/yt-pipeline/publish-next.sh           # produce + upload now
#   ./tools/yt-pipeline/publish-next.sh --dry-run # plan only, no production
#
# This script runs under Doppler `factorylm/prd` (same as the launchd job)
# so secrets are available without any extra setup.

set -euo pipefail

# Resolve repo root regardless of where the user invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

EXTRA_ARGS="${*:-}"

# Show which video this will produce before running so the user can ctrl-C
# if it's not the one they wanted.
NEXT_PREVIEW=$(python3.12 -c "
import sys
sys.path.insert(0, '.')
from tools.yt_pipeline.planner import load_topics, load_calendar
from pathlib import Path
angles = load_topics(Path('tools/yt-pipeline/topics.yaml'))
cal = load_calendar(Path('tools/yt-pipeline/calendar.json'))
idx = cal.get('next_angle_index', 0) % len(angles)
print(f'index={idx} ({idx+1}/{len(angles)})')
print(f'angle={angles[idx][\"angle\"]}')
" 2>&1) || {
  echo "could not preview next angle"
  exit 1
}

echo "=== Next video in queue ==="
echo "$NEXT_PREVIEW"
echo ""
echo "Producing now (Ctrl-C within 3s to abort)..."
sleep 3

exec doppler run --project factorylm --config prd -- \
  python3.12 -m tools.yt_pipeline.main --force $EXTRA_ARGS
