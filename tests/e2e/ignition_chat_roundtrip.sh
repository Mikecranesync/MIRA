#!/usr/bin/env bash
# tests/e2e/ignition_chat_roundtrip.sh — single-command launcher for D10.
#
# Spec / issue: GitHub #1626 (audit task D10).
# Architecture: docs/mira-ignition-secure-architecture.md §9 D10.
#
# Default target: local mira-pipeline at http://localhost:9099. Override
# PIPELINE_URL to hit staging or a remote dev pipeline. The test SKIPS if
# MIRA_IGNITION_HMAC_KEY is not set or the pipeline's /health is down,
# so this is safe to run in any environment.
#
# Exit codes:
#   0  — all tests passed (or skipped)
#   1+ — at least one assertion failed
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

: "${PIPELINE_URL:=http://localhost:9099}"
: "${E2E_TENANT_ID:=11111111-1111-1111-1111-111111111111}"
export PIPELINE_URL E2E_TENANT_ID

if [ -z "${MIRA_IGNITION_HMAC_KEY:-}" ]; then
    if command -v doppler >/dev/null 2>&1; then
        echo "→ MIRA_IGNITION_HMAC_KEY not set; pulling from Doppler factorylm/dev..."
        MIRA_IGNITION_HMAC_KEY="$(doppler secrets get MIRA_IGNITION_HMAC_KEY \
            --project factorylm --config dev --plain 2>/dev/null || true)"
        export MIRA_IGNITION_HMAC_KEY
    fi
fi

if [ -z "${MIRA_IGNITION_HMAC_KEY:-}" ]; then
    echo "→ No HMAC key available — tests will skip (informational)."
fi

exec python3 -m pytest tests/e2e/ignition_chat_roundtrip.py -v --tb=short
