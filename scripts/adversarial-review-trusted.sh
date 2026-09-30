#!/usr/bin/env bash
# Trusted operator entrypoint. Invoke this file from the captured base, e.g.:
#   git show origin/main:scripts/adversarial-review-trusted.sh | bash -s -- 3847 --review-only
# The candidate checkout is used only to reach immutable git objects. All
# producer code and agent cwd/instructions come from a detached base worktree.

set -euo pipefail

PR_NUMBER=""
PASS_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --review-only) PASS_ARGS+=("$arg") ;;
    --max-iter) PASS_ARGS+=("$arg") ;;
    [1-9][0-9]*)
      [ -z "$PR_NUMBER" ] || { echo "ERROR: multiple PR numbers." >&2; exit 3; }
      PR_NUMBER="$arg" ;;
    *) PASS_ARGS+=("$arg") ;;
  esac
done
if [ -z "$PR_NUMBER" ]; then
  echo "ERROR: trusted entrypoint requires an explicit numeric PR number." >&2
  exit 3
fi

SOURCE_REPO="$(git rev-parse --show-toplevel)" || exit 3
PR_JSON="$(gh pr view "$PR_NUMBER" --json baseRefName,baseRefOid,headRefOid,headRefName,isCrossRepository)" || {
  echo "ERROR: could not capture current PR base/head." >&2; exit 2; }
# The single-quoted JavaScript contains a JavaScript template literal.
# shellcheck disable=SC2016
read -r BASE_REF BASE_SHA HEAD_SHA HEAD_REF < <(printf '%s' "$PR_JSON" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d);
    if(typeof p.baseRefName!=="string" || !/^[0-9a-f]{40}$/.test(p.baseRefOid)
      || !/^[0-9a-f]{40}$/.test(p.headRefOid) || typeof p.headRefName!=="string"
      || p.isCrossRepository!==false
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(p.headRefName)
      || p.headRefName.includes("..") || p.headRefName.includes("//")
      || p.headRefName.endsWith("/") || p.headRefName.endsWith(".")) process.exit(1);
    process.stdout.write(`${p.baseRefName} ${p.baseRefOid} ${p.headRefOid} ${p.headRefName}\n`);
  });') || { echo "ERROR: malformed current PR base/head." >&2; exit 2; }

git -C "$SOURCE_REPO" fetch -q origin "$BASE_REF" "pull/$PR_NUMBER/head" || {
  echo "ERROR: could not fetch the captured current base/head objects." >&2; exit 2; }
FETCHED_BASE="$(git -C "$SOURCE_REPO" rev-parse "origin/$BASE_REF")"
if [ "$FETCHED_BASE" != "$BASE_SHA" ]; then
  echo "ERROR: origin/$BASE_REF advanced while the snapshot was captured; retry." >&2
  exit 2
fi
git -C "$SOURCE_REPO" cat-file -e "$HEAD_SHA^{commit}" || {
  echo "ERROR: captured candidate commit is unavailable." >&2; exit 2; }

SESSION_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mira-adversarial-review.XXXXXX")"
PRODUCER_ROOT="$SESSION_ROOT/trusted-base"
REMEDIATION_ROOT="$SESSION_ROOT/candidate-remediation"
# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  git -C "$SOURCE_REPO" worktree remove --force "$REMEDIATION_ROOT" >/dev/null 2>&1 || true
  git -C "$SOURCE_REPO" worktree remove --force "$PRODUCER_ROOT" >/dev/null 2>&1 || true
  rm -rf "$SESSION_ROOT"
}
trap cleanup EXIT
git -C "$SOURCE_REPO" worktree add -q --detach "$PRODUCER_ROOT" "$BASE_SHA"
git -C "$SOURCE_REPO" worktree add -q --detach "$REMEDIATION_ROOT" "$HEAD_SHA"

ENTRYPOINT_BLOB="$(git -C "$SOURCE_REPO" rev-parse "$BASE_SHA:scripts/adversarial-review-trusted.sh")"
if [ "$(git -C "$PRODUCER_ROOT" hash-object scripts/adversarial-review-trusted.sh)" != "$ENTRYPOINT_BLOB" ]; then
  echo "ERROR: trusted entrypoint does not match the captured base object." >&2
  exit 2
fi

export ADV_REVIEW_TRUSTED_BASE_SHA="$BASE_SHA"
export ADV_REVIEW_CANDIDATE_SHA="$HEAD_SHA"
export ADV_REVIEW_SOURCE_REPO="$SOURCE_REPO"
export ADV_REVIEW_REMEDIATION_WORKTREE="$REMEDIATION_ROOT"
export ADV_REVIEW_HEAD_REF="$HEAD_REF"
export ADV_REVIEW_OUT_DIR="$SESSION_ROOT/artifacts"
mkdir -m 700 "$ADV_REVIEW_OUT_DIR"

set +e
(
  cd "$PRODUCER_ROOT"
  bash scripts/adversarial-review-loop.sh "$PR_NUMBER" \
    ${PASS_ARGS[@]+"${PASS_ARGS[@]}"}
)
RC=$?
set -e
exit "$RC"
