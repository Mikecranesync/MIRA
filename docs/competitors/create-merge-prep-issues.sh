#!/usr/bin/env bash
# Batch-create the 6 cowork merge-prep cross-cutting issues.
# These unblock the parity branches landed by the overnight cowork run.
set -euo pipefail

REPO="Mikecranesync/MIRA"
MS="Factory AI Parity"
LABEL_BASE="cowork-merge-prep,enhancement"

# Pre-flight: ensure label exists.
gh label create "cowork-merge-prep" --repo "$REPO" --color "B60205" \
  --description "Cross-cutting work to unblock cowork parity branches before merge" 2>/dev/null || true

DIR="$(dirname "$0")/issue-bodies/cross-cutting"

new() {
  local title="$1" body="$2" extra="${3:-}"
  local labels="$LABEL_BASE"
  [ -n "$extra" ] && labels="$labels,$extra"
  gh issue create --repo "$REPO" --milestone "$MS" --label "$labels" \
    --title "$title" --body-file "$DIR/$body" | tee -a /tmp/mergeprep-issues.log
}

: > /tmp/mergeprep-issues.log

new "merge-prep: install npm deps + commit lockfile (consolidating PR)" \
    01-npm-deps-install.md "P0,infra"

new "merge-prep: provision 13 Doppler env vars across dev/stg/prd" \
    02-doppler-env-vars.md "P0,security,infra"

new "merge-prep: auth-sweep — replace ~80 x-tenant-id stubs with withTenant() (post-#578)" \
    03-auth-sweep.md "P0,security,tenant-isolation"

new "merge-prep: wire #576 webhook dispatcher into every event source" \
    04-webhook-event-wiring.md "P1"

new "merge-prep: install vitest + per-branch test-suite baseline" \
    05-test-suite-baseline.md "P1,testing"

new "merge-prep: migration deploy-order doc + CI check + cutover runbook" \
    06-migration-deploy-order.md "P0,infra,documentation"

echo "---"
echo "All done. URLs:"
grep -o "https://github.com/$REPO/issues/[0-9]*" /tmp/mergeprep-issues.log
