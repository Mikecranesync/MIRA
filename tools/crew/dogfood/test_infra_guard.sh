#!/usr/bin/env bash
# Hermetic regression guard: when the staging Hub is UNREACHABLE, every check
# must classify the failure as INFRA (flaky — never filed), NOT as a product RED.
#
# Why this exists: on 2026-07-07 the whole stg-* stack was down for ~2h. The
# dogfood run correctly returned INFRA for 4 paths, but contextualization and
# demo-readiness returned RED ("no asset") — because they fetched /api/assets and
# parsed an empty/failed response as "zero assets" instead of detecting the
# outage. With DOGFOOD_FILE_ISSUES=1 that would have FILED false product bugs
# during an outage. The fix: every check leads with the /api/me reachability+auth
# guard (as maintenance-tech.check always had). This test points each check at an
# unreachable port and asserts the last line is INFRA.
#
# Run: bash tools/crew/dogfood/test_infra_guard.sh   (no Hub, no GitHub)
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1

CHECK_DIR="tools/crew/dogfood/checks"
# An address that refuses instantly — curl fails, /api/me returns empty → INFRA.
UNREACHABLE="http://127.0.0.1:1"

pass=0; fail=0
for f in "$CHECK_DIR"/*.check; do
  name="$(basename "$f" .check)"
  # Source in a subshell so each check's SCN_*/run_check can't leak between files.
  last="$(
    set +e
    # shellcheck disable=SC1090
    DF_BASE="$UNREACHABLE" DF_TOK="dummy-token" DF_PERSONA="tester" \
      bash -c 'source "$1"; run_check' _ "$f" 2>/dev/null | grep -E '^(GREEN|YELLOW|RED|INFRA)' | tail -1
  )"
  if [[ "$last" == INFRA* ]]; then
    echo "PASS: $name → INFRA when Hub unreachable"
    pass=$((pass+1))
  else
    echo "FAIL: $name → '${last:-<no verdict>}' (expected INFRA when Hub unreachable)"
    fail=$((fail+1))
  fi
done

echo "──────────────"
echo "RESULT: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
