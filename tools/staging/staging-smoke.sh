#!/usr/bin/env bash
# staging-smoke.sh — deterministic health gate for the MIRA staging digital twin.
#
# This is the PASS/FAIL layer (Cluster Law 2: a binary check is a script, not an
# LLM). It curls the externally-reachable staging review surfaces and asserts
# each returns a healthy status. The qualitative "does the change look right"
# judgment is a SEPARATE, async layer — see hermes-staging-review.sh, which runs
# this gate first and only proceeds to browse/judge if it passes.
#
# Surface split (intentional):
#   - Hub (4101) + Web (4200) are the externally-reachable surfaces a human or
#     Hermes actually reviews — REQUIRED here.
#   - Pipeline (4099) + Atlas (4088) are internal services; the deploy workflow
#     (.github/workflows/deploy-staging.yml) health-checks them on 127.0.0.1
#     during deploy. They are probed here BEST-EFFORT (reported, never fatal)
#     because they may be bound internal-only on the VPS.
#
# Usage:
#   tools/staging/staging-smoke.sh                 # default VPS public IP
#   STAGING_HOST=165.245.138.91 tools/staging/staging-smoke.sh
#   STAGING_HOST=127.0.0.1 tools/staging/staging-smoke.sh   # run ON the VPS
#
# Exit code: 0 = all REQUIRED surfaces healthy; 1 = at least one failed.
set -uo pipefail

HOST="${STAGING_HOST:-165.245.138.91}"
HUB_PORT="${STAGING_HUB_PORT:-4101}"
WEB_PORT="${STAGING_WEB_PORT:-4200}"
PIPE_PORT="${STAGING_PIPELINE_PORT:-4099}"
ATLAS_PORT="${STAGING_ATLAS_PORT:-4088}"
TIMEOUT="${STAGING_SMOKE_TIMEOUT:-10}"

fail=0

# probe NAME URL EXPECTED_CODE REQUIRED(yes|no)
probe() {
  local name="$1" url="$2" want="$3" required="$4"
  local code
  code=$(curl -sL -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null)
  if [ "$code" = "$want" ]; then
    printf '  ✓ %-10s %s → HTTP %s\n' "$name" "$url" "$code"
  else
    printf '  ✗ %-10s %s → HTTP %s (want %s)\n' "$name" "$url" "${code:-000}" "$want"
    if [ "$required" = "yes" ]; then fail=1; fi
  fi
}

echo "=== MIRA staging digital-twin smoke gate (host=$HOST) ==="
echo "--- REQUIRED review surfaces ---"
probe "hub"      "http://$HOST:$HUB_PORT/api/health" 200 yes
probe "web"      "http://$HOST:$WEB_PORT/"           200 yes
echo "--- best-effort internal services (deploy workflow is authoritative) ---"
probe "pipeline" "http://$HOST:$PIPE_PORT/health"    200 no
probe "atlas"    "http://$HOST:$ATLAS_PORT/"         200 no

if [ "$fail" -eq 0 ]; then
  echo "=== RESULT: PASS — staging twin review surfaces are healthy ==="
  exit 0
fi
echo "=== RESULT: FAIL — a required staging surface is unhealthy ==="
exit 1
