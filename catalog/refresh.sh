#!/usr/bin/env bash
# catalog/refresh.sh — re-run deterministic discovery, regenerate, and validate.
# Phase 6 refresh entry point. Idempotent for the parts it owns; the evidence-heavy
# Phase 2/3 inventories are refreshed by re-running the scouts (see .claude/commands/catalog-org.md),
# which is intentionally NOT automated here (it needs the sole-writer + spot-verify discipline).
set -euo pipefail
cd "$(dirname "$0")/.."          # repo root
CAT=catalog

echo "==> [1/3] Re-discover org repositories (gh)"
if command -v gh >/dev/null 2>&1; then
  gh repo list Mikecranesync --limit 100 \
    --json name,description,primaryLanguage,defaultBranchRef,isArchived,pushedAt,visibility,repositoryTopics,diskUsage,createdAt \
    > "$CAT/evidence/gh-repo-list.json"
  echo "    captured $(python3 -c "import json;print(len(json.load(open('$CAT/evidence/gh-repo-list.json'))))") repos"
else
  echo "    gh not installed — reusing existing evidence/gh-repo-list.json"
fi

echo "==> [2/3] Regenerate organization.yaml"
python3 "$CAT/build_organization.py"

echo "==> [3/3] Validate catalog"
python3 "$CAT/validate.py"

cat <<'NOTE'

Refreshed: organization.yaml + validation.
Stale-entry / deleted-component detection: validate.py errors on any fact whose
referenced file no longer exists in a locally-resolvable repo (MIRA, factorylm) —
that surfaces removed/renamed components for review rather than silently dropping them.

To refresh the Phase 2/3 inventories (services/apis/databases/relationships), re-run the
scout dispatch documented in .claude/commands/catalog-org.md, then spot-verify before commit.
NOTE
