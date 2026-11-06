#!/usr/bin/env bash
# Deploy (or redeploy) the minimum recovery stack — Hub only — for #3800.
#
# Runs on the recovery host from /opt/mira, or locally from a checkout for the
# private test. Secrets are injected at runtime by Doppler from a SCOPED
# service token in DOPPLER_TOKEN (create it in Doppler for exactly one config;
# never use a personal token, never write secrets to disk).
#
#   DOPPLER_TOKEN=dp.st.… DOPPLER_CONFIG=stg RECOVERY_PUBLIC_URL=http://localhost:3101 \
#     bash tools/recovery/deploy-recovery.sh                 # test mode
#   DOPPLER_TOKEN=dp.st.… DOPPLER_CONFIG=prd RECOVERY_PUBLIC_URL=https://app.factorylm.com \
#     bash tools/recovery/deploy-recovery.sh                 # cutover (human-gated)
#
# Options:
#   --image <tar.gz>   load a prebuilt image instead of building on this host
#                      (recommended on a small VPS; build on CHARLIE, `docker save`)
#   --no-build         reuse whatever mira-hub image is already present
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO="$(pwd)"
CFG="${DOPPLER_CONFIG:-stg}"
IMAGE_TAR=""
BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE_TAR="$2"; BUILD=0; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${RECOVERY_PUBLIC_URL:-}" ] || { echo "RECOVERY_PUBLIC_URL is required (e.g. http://localhost:3101)" >&2; exit 2; }
if [ -z "${DOPPLER_TOKEN:-}" ]; then
  # A developer's interactive Doppler login is acceptable for the PRIVATE TEST
  # only. The recovery host itself always gets a scoped service token.
  if [ "$CFG" = "prd" ]; then
    echo "DOPPLER_TOKEN (scoped service token for factorylm/prd) is required for a prd deploy" >&2; exit 2
  fi
  doppler me >/dev/null 2>&1 || { echo "no DOPPLER_TOKEN and no interactive Doppler login" >&2; exit 2; }
  echo "note: using the interactive Doppler login (test mode only)"
fi
if [ "$CFG" = "prd" ] && [ "${RECOVERY_ALLOW_PROD:-0}" != "1" ]; then
  echo "REFUSING: DOPPLER_CONFIG=prd targets production Neon. Set RECOVERY_ALLOW_PROD=1 only at the human-approved cutover." >&2
  exit 3
fi

COMPOSE=(docker compose -f docker-compose.saas.yml -f tools/recovery/compose.recovery.yml)
SHA="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export MIRA_GIT_SHA="$SHA" MIRA_APP_VERSION="recovery-$SHORT" MIRA_BUILD_TIME="$NOW"
export RECOVERY_PUBLIC_URL NEXT_PUBLIC_PIPELINE_API_URL="$RECOVERY_PUBLIC_URL"

echo "repo=$REPO sha=$SHA doppler=factorylm/$CFG public_url=$RECOVERY_PUBLIC_URL"

if [ -n "$IMAGE_TAR" ]; then
  echo "loading prebuilt image from $IMAGE_TAR"
  gunzip -c "$IMAGE_TAR" | docker load
elif [ "$BUILD" = 1 ]; then
  echo "building mira-hub on this host (set --image to avoid this on small VPSs)"
  DOCKER_BUILDKIT=1 doppler run --project factorylm --config "$CFG" -- "${COMPOSE[@]}" build mira-hub
fi

# `--no-deps` is the whole point: nothing but the Hub starts.
doppler run --project factorylm --config "$CFG" -- "${COMPOSE[@]}" up -d --no-deps --force-recreate mira-hub

# Readiness: the csrf door answers 200 once NextAuth + Neon are wired.
BIND="${RECOVERY_HUB_BIND:-127.0.0.1:3101}"
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://${BIND}/api/auth/csrf/" || true)
  if [ "$code" = "200" ]; then echo "hub ready after ~$((i*3))s at http://${BIND}"; break; fi
  sleep 3
  if [ "$i" = 40 ]; then echo "hub never became ready" >&2; "${COMPOSE[@]}" logs --tail=50 mira-hub; exit 1; fi
done
curl -s "http://${BIND}/api/health/" | head -c 400; echo
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
