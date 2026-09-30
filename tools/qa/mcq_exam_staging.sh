#!/usr/bin/env bash
# The 100-question industrial maintenance exam, asked through MIRA on STAGING.
#
# Same questions tests/mira_eval.py puts to a bare model, asked through the
# deployed staging Hub chat route (web + phone path) as a throwaway stranger,
# one blank chat per question. Answer key: tests/benchmark/mira_mcq_benchmark.json.
#
# Usage:  bash tools/qa/mcq_exam_staging.sh [out-dir] [--limit N]
# Needs:  doppler (factorylm/stg), bun (mira-hub deps installed), Python 3.12 as $PYTHON.
# Refuses any base other than app-staging (answer_radar/hub_runner.py).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$REPO/answer_radar/runs/mcq-exam-$(date -u +%Y-%m-%d)}"
shift || true
BASE="${ANSWER_RADAR_BASE:-https://app-staging.factorylm.com}"
# Codex #4063 F1: validate the target BEFORE any network call or provisioning.
# Only the exact HTTPS staging origin is allowed (a trailing slash is tolerated);
# everything below — curl, the provisioner, the sweep, the batch — uses $BASE.
case "${BASE%/}" in
  https://app-staging.factorylm.com) BASE="https://app-staging.factorylm.com" ;;
  *) echo "refusing non-staging target: $BASE (only https://app-staging.factorylm.com)" >&2; exit 2 ;;
esac
TMP="$(mktemp -d)"
TENANT=""

cleanup() {
  local rc=$?
  if [ -n "$TENANT" ]; then
    # Codex #4063 F6: a failed sweep fails the run and names the tenant to remove.
    if ! ( cd "$REPO/mira-hub" && HUB_BASE="$BASE" doppler run --project factorylm --config stg -- \
        bun run scripts/provision-beta-gate.ts --cleanup "$TENANT" >/dev/null 2>&1 ); then
      echo "ERROR: stranger sweep FAILED — staging tenant $TENANT still exists. Remove it with:" >&2
      echo "  (cd mira-hub && HUB_BASE=$BASE doppler run --project factorylm --config stg -- bun run scripts/provision-beta-gate.ts --cleanup $TENANT)" >&2
      [ "$rc" -eq 0 ] && rc=3
    fi
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap cleanup EXIT

echo "deployed on staging: $(curl -fsS --max-time 30 "$BASE/api/version/" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("gitSha","?"))')" >&2

( cd "$REPO/mira-hub" && HUB_BASE="$BASE" doppler run --project factorylm --config stg -- \
    bun run scripts/provision-beta-gate.ts ) >"$TMP/env.out" 2>"$TMP/provision.err" || {
  echo "stranger provisioning failed:" >&2
  sed -E 's/(cookie|token|secret)[^ ]*/[redacted]/Ig' "$TMP/provision.err" | tail -20 >&2
  exit 1
}
TENANT="$(sed -n 's/^ENV:BETA_GATE_TENANT=//p' "$TMP/env.out")"
COOKIE="$(sed -n 's/^ENV:BETA_GATE_COOKIE=//p' "$TMP/env.out")"
[ -n "$TENANT" ] && [ -n "$COOKIE" ] || { echo "provisioner printed no tenant/cookie" >&2; exit 1; }

cd "$REPO"
ANSWER_RADAR_BASE="$BASE" ANSWER_RADAR_COOKIE="$COOKIE" PYTHONPATH="$REPO" \
  "${PYTHON:-python3}" -m answer_radar.mcq_hub --out "$OUT" "$@"
echo "results: $OUT" >&2
