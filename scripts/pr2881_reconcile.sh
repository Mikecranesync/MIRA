#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:?PR number required}"
if [ "$PR_NUMBER" != "2881" ]; then
  echo "This temporary reconciler is scoped to PR #2881 only." >&2
  exit 2
fi

HEAD_BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName --jq '.headRefName')"
LOG_FILE="/tmp/pr2881-validation.log"

comment_log() {
  local title="$1"
  local status="$2"
  {
    echo "## ${title}"
    echo
    echo "Status: **${status}**"
    echo
    echo '```text'
    tail -n 160 "$LOG_FILE" 2>/dev/null || true
    echo '```'
    echo
    echo "No Together upload, fine-tune job, endpoint, deployment, authorization consumption, or spend was performed."
  } > /tmp/pr2881-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/pr2881-comment.md
}

exec > >(tee "$LOG_FILE") 2>&1

echo "[pr2881] Fetching current main and reconciling ${HEAD_BRANCH}"
git fetch origin main

set +e
git merge --no-commit --no-ff origin/main
MERGE_RC=$?
set -e

echo "[pr2881] git merge exit: ${MERGE_RC}"
UNRESOLVED="$(git diff --name-only --diff-filter=U || true)"
UNEXPECTED="$(printf '%s\n' "$UNRESOLVED" | grep -v -E '^(VERSION|docs/CHANGELOG\.md)$' || true)"
if [ -n "$UNEXPECTED" ]; then
  echo "Unexpected merge conflicts; refusing automatic resolution:"
  printf '%s\n' "$UNEXPECTED"
  comment_log "PR #2881 reconciliation blocked" "FAILED"
  git merge --abort || true
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
import subprocess


def show(spec: str) -> str:
    return subprocess.check_output(["git", "show", spec], text=True)

try:
    ours = show(":2:docs/CHANGELOG.md")
except subprocess.CalledProcessError:
    ours = show("HEAD:docs/CHANGELOG.md")
try:
    main = show(":3:docs/CHANGELOG.md")
except subprocess.CalledProcessError:
    main = show("origin/main:docs/CHANGELOG.md")

marker = "\n### v3.211.1 "
security_section = ours.split(marker, 1)[0].rstrip()
security_section = security_section.replace("(2026-07-23)", "(2026-07-24)", 1)
trust_bullet = (
    "- **Paid authorization now has a real trust root.** Operator approvals are "
    "Ed25519-signed offline; the paid runtime holds only the public verification "
    "key, rejects caller-supplied verifiers, and requires an exact signed-registry "
    "match before atomic ledger enrollment and consumption."
)
if trust_bullet not in security_section:
    needle = "\nRegression coverage:"
    if needle in security_section:
        security_section = security_section.replace(
            needle, f"\n{trust_bullet}\n\nRegression coverage:", 1
        )
    else:
        security_section += "\n\n" + trust_bullet

Path("docs/CHANGELOG.md").write_text(
    security_section + "\n\n" + main.lstrip(), encoding="utf-8"
)
Path("VERSION").write_text("3.211.2\n", encoding="utf-8")
PY

git add VERSION docs/CHANGELOG.md

# Temporary reconciliation scaffolding must not remain in the final PR tree.
git checkout origin/main -- scripts/pr_self_fix.sh
git rm -f scripts/pr2881_reconcile.sh
if [ -f .github/workflows/pr2881-reconcile.yml ]; then
  git rm -f .github/workflows/pr2881-reconcile.yml
fi
git add scripts/pr_self_fix.sh

REMAINING="$(git diff --name-only --diff-filter=U || true)"
if [ -n "$REMAINING" ]; then
  echo "Unresolved conflicts remain:"
  printf '%s\n' "$REMAINING"
  comment_log "PR #2881 reconciliation blocked" "FAILED"
  git merge --abort || true
  exit 1
fi

echo "[pr2881] Installing the same dependency families used by unit CI"
python3 -m pip install --disable-pip-version-check -q \
  -r mira-core/mira-ingest/requirements.txt \
  -r mira-bots/telegram/requirements.txt \
  -r mira-bots/teams/requirements.txt
python3 -m pip install --disable-pip-version-check -q \
  PyJWT cryptography pytest pytest-asyncio pytest-cov pytest-xdist \
  "ruff==0.9.*" pyright

echo "[pr2881] Running focused validation"
set +e
(
  set -e
  python3 -m pytest tests/factorylm_ai -q
  python3 -m ruff check factorylm_ai tests/factorylm_ai
  python3 -m ruff format --check factorylm_ai tests/factorylm_ai
  pyright \
    factorylm_ai/finetune.py \
    factorylm_ai/pricing.py \
    factorylm_ai/providers/__init__.py \
    factorylm_ai/providers/together.py \
    factorylm_ai/providers/paid_authorization_guard.py \
    tests/factorylm_ai/test_finetune_orchestration.py \
    tests/factorylm_ai/test_flm_ai_providers.py \
    tests/factorylm_ai/test_paid_authorization_trust_boundary.py
  git diff --cached --check
)
VALIDATION_RC=$?
set -e

if [ "$VALIDATION_RC" -ne 0 ]; then
  echo "[pr2881] Validation failed with exit ${VALIDATION_RC}; merge commit not created."
  comment_log "PR #2881 focused validation" "FAILED"
  git merge --abort || true
  exit "$VALIDATION_RC"
fi

echo "[pr2881] Validation passed; creating reconciliation merge commit"
git commit -m "merge(main): reconcile paid Together execution hardening"
git push origin "HEAD:${HEAD_BRANCH}"
comment_log "PR #2881 reconciled and validated" "PASSED"
