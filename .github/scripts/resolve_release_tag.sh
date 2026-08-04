#!/usr/bin/env bash
# Resolve the release tag to deploy — anchored on an IMMUTABLE commit SHA (#3055).
#
# The bug this closes: deploy-vps.yml used to resolve the release tag from
# `origin/main` (a MOVING ref) and, when version-tag.yml had not yet laid the tag,
# fall back to `git reset --hard origin/main` — deploying whatever main pointed at,
# which may be a NEWER commit than the one that passed the staging gate + smoke, or
# an untagged commit with no rollback checkpoint.
#
# Contract (stdout is consumed by the caller; everything else goes to stderr):
#   stdout : the vX.Y.Z tag to check out, OR empty (empty is reachable ONLY on the
#            explicit hotfix path — the caller then deploys the pinned DEPLOY_SHA,
#            never a moving ref).
#   exit 0 : resolved a tag, or hotfix-fallback to the pinned SHA.
#   exit 1 : FAIL CLOSED — no tag at DEPLOY_SHA within the bounded wait and this is
#            not an authorised hotfix. The deploy must abort rather than ship an
#            untagged/moving ref.
#
# Inputs (environment):
#   DEPLOY_SHA             (required) full 40-hex commit SHA that passed the gate.
#   ALLOW_MOVING_FALLBACK  "1" only on an operator hotfix dispatch; default "0".
#   TAG_WAIT_ATTEMPTS      bounded poll count (default 20).
#   TAG_WAIT_SECONDS       sleep between attempts (default 15) → default ~5 min cap.
set -euo pipefail

DEPLOY_SHA="${DEPLOY_SHA:-}"
ALLOW_MOVING_FALLBACK="${ALLOW_MOVING_FALLBACK:-0}"
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

if [ "$ALLOW_MOVING_FALLBACK" = "1" ]; then
  echo "::warning::No release tag at ${DEPLOY_SHA} after ${ATTEMPTS} attempts — HOTFIX fallback: deploying the pinned SHA (version will report 'unknown', and no rollback checkpoint exists for it)." >&2
  printf '%s\n' ""   # empty ⇒ caller checks out the pinned DEPLOY_SHA (still immutable)
  exit 0
fi

echo "::error::No vX.Y.Z tag at ${DEPLOY_SHA} after ${ATTEMPTS} attempts. version-tag.yml did not tag this commit; failing closed rather than deploying an untagged or moving ref. For a genuine hotfix, dispatch deploy-vps.yml with skip_staging_gate=true (authorises the pinned-SHA fallback)." >&2
exit 1
