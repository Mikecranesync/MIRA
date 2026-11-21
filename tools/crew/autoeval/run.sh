#!/bin/bash
# autoeval wrapper: points one DETACHED checkout at origin/main and runs the judge from it.
# Never invokes claude. Dry by default: paid calls need `--paid` AND a paid.json in the state dir.
# Usage: run.sh [autoeval run arguments...]   e.g.  run.sh --skip-lanes
# AUTOEVAL_REF overrides the tested ref (default origin/main), for trying a branch before merge.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
STATE="${AUTOEVAL_STATE_DIR:-$HOME/.factorylm/autoeval}"
REF="${AUTOEVAL_REF:-origin/main}"
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

# One fixed checkout, reused across runs so mira-hub/node_modules survives between them.
# It is the runner's own: tracked files are force-reset to the tested ref on every run.
if git -C "$CHECKOUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$CHECKOUT" checkout --quiet --force --detach "$REF"
elif [ -e "$CHECKOUT" ]; then
  echo "autoeval: $CHECKOUT exists but is not a git worktree; move it aside and re-run" >&2
  exit 5
else
  # clears only this path's registration if the directory was deleted by hand
  git -C "$REPO" worktree remove --force "$CHECKOUT" 2>/dev/null || true
  git -C "$REPO" worktree add --quiet --detach "$CHECKOUT" "$REF"
fi

cd "$CHECKOUT"
# Hub lanes need installed dependencies, exactly as the lockfile pins them.
if command -v bun >/dev/null 2>&1; then
  (cd mira-hub && bun install --frozen-lockfile >/dev/null 2>&1) ||
    echo "autoeval: bun install failed; Hub lanes will report infra_error" >&2
else
  echo "autoeval: bun not on PATH; Hub lanes will report infra_error" >&2
fi

echo "autoeval: tested $(git rev-parse HEAD) ($REF) state=$STATE" >&2
python3.12 evals/scripts/autoeval.py run --state-dir "$STATE" "$@"
