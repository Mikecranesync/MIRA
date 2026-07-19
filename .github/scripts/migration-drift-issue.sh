#!/usr/bin/env bash
# Files (or refreshes) the P1 ops issue when the migration-drift check fails.
# Idempotent: one open issue per target — comments on it if it already exists.
# Usage: migration-drift-issue.sh <target> <run_url>
set -euo pipefail

TARGET="${1:?target required (staging|prod)}"
RUN_URL="${2:?run url required}"
TITLE="ops(P1): migration drift detected on ${TARGET} — merged migrations not applied"

EXISTING=$(gh issue list --state open --search "in:title \"migration drift detected on ${TARGET}\"" --json number --jq '.[0].number // empty')

BODY="Nightly migration-drift check FAILED for **${TARGET}**: at least one migration merged to \`main\` is not recorded in that DB's \`schema_migrations\` ledger.

Run (drifted files in the job summary): ${RUN_URL}

**Fix:** \`gh workflow run apply-migrations.yml -f target=${TARGET} -f migrations=all -f mode=dry-run\` (review) then \`mode=apply\`; ingest-family drift uses \`apply-ingest-migrations.yml\` the same way.

Context: the 2026-07-14 061-064 incident (9 days of asset-enrich 500s on prod because a merged GRANT migration was never promoted). Runbook: \`docs/runbooks/migration-apply-and-drift.md\`."

if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --body "Still drifting as of this run: ${RUN_URL}"
  echo "commented on existing issue #$EXISTING"
else
  gh issue create --title "$TITLE" --label "bug" --body "$BODY"
fi
