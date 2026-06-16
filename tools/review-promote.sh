#!/usr/bin/env bash
# review-promote.sh — VPS cron worker for /admin/review approvals.
#
# Scans marketing/cartoons/ and docs/promo-screenshots/ for *.review.json
# sidecars. For each sidecar whose status == "approved":
#   1. Move the original asset into a `published/` subdir alongside it.
#   2. git add -A && commit && push (only if the working tree is clean
#      apart from these moves).
#   3. Delete the sidecar.
#
# Rejected sidecars: rename asset to *.rejected.<ext>, delete sidecar.
#
# Idempotent — safe to run on every cron tick. Wired into
# scripts/install_crons.sh (every 10 min).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/mira}"
LOG_TAG="[review-promote]"

cd "$REPO_DIR"

# Refuse if there are unrelated unstaged changes — we don't want to swallow
# someone else's WIP into our auto-commit. Look only at the dirs we touch.
DIRTY_OUTSIDE=$(git status --porcelain -- ':!marketing/cartoons' ':!docs/promo-screenshots' | head -1 || true)
if [ -n "$DIRTY_OUTSIDE" ]; then
  echo "$LOG_TAG WARN — unrelated working-tree changes present, skipping run" >&2
  echo "$LOG_TAG offending: $DIRTY_OUTSIDE" >&2
  exit 0
fi

# Pull first so we're committing on top of latest.
git fetch --quiet origin main
git checkout --quiet main
git reset --hard --quiet origin/main

CHANGES=0

# Generic: read every *.review.json under the two source dirs, act on it.
while IFS= read -r SIDECAR; do
  [ -f "$SIDECAR" ] || continue
  STATUS=$(jq -r '.status // empty' < "$SIDECAR" 2>/dev/null || echo "")
  if [ -z "$STATUS" ]; then
    echo "$LOG_TAG WARN — unreadable sidecar $SIDECAR" >&2
    continue
  fi
  ASSET="${SIDECAR%.review.json}"
  if [ ! -f "$ASSET" ]; then
    echo "$LOG_TAG WARN — asset missing for $SIDECAR" >&2
    rm -f "$SIDECAR"
    CHANGES=1
    continue
  fi
  ASSET_DIR=$(dirname "$ASSET")
  ASSET_NAME=$(basename "$ASSET")
  EXT="${ASSET_NAME##*.}"
  STEM="${ASSET_NAME%.*}"
  APPROVED_BY=$(jq -r '.approvedBy // "unknown"' < "$SIDECAR")

  if [ "$STATUS" = "approved" ]; then
    PUB_DIR="$ASSET_DIR/published"
    mkdir -p "$PUB_DIR"
    DEST="$PUB_DIR/$ASSET_NAME"
    git mv -f "$ASSET" "$DEST"
    rm -f "$SIDECAR"
    git add -A "$ASSET_DIR"
    git commit -m "promo: publish ${ASSET_NAME} (approved by ${APPROVED_BY})" --quiet
    echo "$LOG_TAG published ${ASSET_NAME}"
    CHANGES=1
  elif [ "$STATUS" = "rejected" ]; then
    REJECTED="$ASSET_DIR/${STEM}.rejected.${EXT}"
    git mv -f "$ASSET" "$REJECTED"
    rm -f "$SIDECAR"
    git add -A "$ASSET_DIR"
    git commit -m "promo: reject ${ASSET_NAME} (rejected by ${APPROVED_BY})" --quiet
    echo "$LOG_TAG rejected ${ASSET_NAME}"
    CHANGES=1
  else
    echo "$LOG_TAG noop — sidecar status=$STATUS for $ASSET_NAME"
  fi
done < <(find marketing/cartoons docs/promo-screenshots -type f -name '*.review.json' 2>/dev/null || true)

if [ "$CHANGES" -gt 0 ]; then
  if git push --quiet origin main; then
    echo "$LOG_TAG pushed to origin/main"
  else
    echo "$LOG_TAG ERROR — push failed, leaving commits local for manual recovery" >&2
    exit 1
  fi
else
  echo "$LOG_TAG no sidecars to process"
fi
