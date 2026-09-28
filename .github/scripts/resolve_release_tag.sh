#!/usr/bin/env bash
# Resolve the release tag to deploy — anchored on an IMMUTABLE commit SHA (#3055).
#
# Resolve vX.Y.Z tag at a pinned DEPLOY_SHA. The SHA is the immutable anchor
# (passed through deploy-vps.yml's approved_rc_sha input). No fallback to moving
# refs. If no tag exists after bounded wait, fail closed.
#
# Contract (stdout is consumed by the caller; everything else goes to stderr):
#   stdout : the vX.Y.Z tag to check out.
#   exit 0 : resolved a tag.
#   exit 1 : FAIL CLOSED — no tag at DEPLOY_SHA within the bounded wait.
#
# Inputs (environment):
#   DEPLOY_SHA             (required) full 40-hex commit SHA that passed the gate.
#   TAG_WAIT_ATTEMPTS      bounded poll count (default 20).
#   TAG_WAIT_SECONDS       sleep between attempts (default 15) → default ~5 min cap.
set -euo pipefail

DEPLOY_SHA="${DEPLOY_SHA:-}"
ATTEMPTS="${TAG_WAIT_ATTEMPTS:-20}"
SLEEP_SECONDS="${TAG_WAIT_SECONDS:-15}"

# Enforce "one immutable SHA": reject an empty or non-hex (branch-like) value so a
# moving ref can never be smuggled in as the deploy anchor.
case "$DEPLOY_SHA" in
  "" | *[!0-9a-f]*)
    echo "::error::DEPLOY_SHA is not a commit hash ('${DEPLOY_SHA}') — refusing to resolve a release tag against a moving/unknown ref." >&2
    exit 1
    ;;
esac

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  git fetch origin --tags --force --quiet 2>/dev/null || true
  tag="$(git tag --points-at "$DEPLOY_SHA" --list 'v[0-9]*' | sort -V | tail -1)"
  if [ -n "$tag" ]; then
    echo "Resolved release tag ${tag} at ${DEPLOY_SHA} (attempt ${attempt}/${ATTEMPTS})." >&2
    printf '%s\n' "$tag"
    exit 0
  fi
  echo "No vX.Y.Z tag at ${DEPLOY_SHA} yet (attempt ${attempt}/${ATTEMPTS}); version-tag.yml may still be running." >&2
  attempt=$((attempt + 1))
  if [ "$attempt" -le "$ATTEMPTS" ]; then
    sleep "$SLEEP_SECONDS"
  fi
done

echo "::error::No vX.Y.Z tag at ${DEPLOY_SHA} after ${ATTEMPTS} attempts. version-tag.yml did not tag this commit; failing closed." >&2
exit 1
