#!/bin/bash
# autoeval wrapper: refreshes a DETACHED origin/main checkout at a fixed path and runs the judge.
# Never invokes claude. Dry by default: paid calls need `--paid` AND a paid.json in the state dir.
# Usage: run.sh [autoeval run arguments...]   e.g.  run.sh --skip-lanes
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
STATE="${AUTOEVAL_STATE_DIR:-$HOME/.factorylm/autoeval}"
CHECKOUT="$STATE/checkout"
LOCK="$STATE/run.lock"

case "$CHECKOUT" in
  */autoeval/checkout) ;;
  *) echo "autoeval: refusing unexpected checkout path $CHECKOUT" >&2; exit 5 ;;
esac

mkdir -p "$STATE"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "autoeval: another run holds $LOCK (remove it only if no run is alive)" >&2
  exit 4
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

git -C "$REPO" fetch --quiet origin main

# Defensive pre-clean: a checkout left by an earlier run is replaced, never reused.
git -C "$REPO" worktree prune
if [ -e "$CHECKOUT" ]; then
  echo "autoeval: removing previous checkout $CHECKOUT" >&2
  git -C "$REPO" worktree remove --force "$CHECKOUT" 2>/dev/null || rm -rf "$CHECKOUT"
fi
git -C "$REPO" worktree add --detach "$CHECKOUT" origin/main

cd "$CHECKOUT"
echo "autoeval: tested $(git rev-parse HEAD) state=$STATE" >&2
python3.12 evals/scripts/autoeval.py run --state-dir "$STATE" "$@"
