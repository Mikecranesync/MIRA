#!/usr/bin/env bash
# Run the MIRA vs ungrounded-LLM benchmark against the staging Neon branch.
# Read-only. Outputs to docs/evaluations/runs/<today>/.

set -euo pipefail

cd "$(dirname "$0")/.."

DATE_DIR="docs/evaluations/runs/$(date +%Y-%m-%d)"
mkdir -p "$DATE_DIR"

echo "Running MIRA vs ungrounded-LLM benchmark"
echo "  output: $DATE_DIR"
echo "  doppler: factorylm/stg"
echo

exec doppler run --project factorylm --config stg -- \
    python3 tests/mira_bench.py --output "$DATE_DIR" "$@"
