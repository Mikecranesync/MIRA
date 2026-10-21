#!/usr/bin/env bash
# Benchmark acceptance run (zero tokens) for one question set, on the node that holds the data.
#
#   BENCH_PG=postgres://bench@localhost:55432/bench \
#     bash tools/benchmark-acceptance/run_on_data_node.sh <set-name> <questions.json> <out-dir> [external.json]
#
# Runs in a throwaway detached worktree of the pinned SHA (never the shared checkout), removed on every exit
# path. Produces <out-dir>/<set>-<arm>-k<topK>.jsonl and one scorecard per topK. For the sealed unseen set, read
# only the verdict line and the aggregate table (docs/evals/2026-10-21-benchmark-acceptance-preregistration.md).
set -euo pipefail

SET_NAME="${1:?set name}"
QUESTIONS="$(cd "$(dirname "${2:?questions.json}")" && pwd)/$(basename "$2")"
mkdir -p "${3:?out dir}"
OUT="$(cd "$3" && pwd)"
EXTERNAL="${4:-}"
: "${BENCH_PG:?set BENCH_PG to a throwaway Postgres with the staging knowledge_entries schema}"
export BENCH_PG
unset NOTEBOOK_HYBRID_RETRIEVAL NOTEBOOK_RERANK

REPO="$(git rev-parse --show-toplevel)"
SHA="$(git -C "$REPO" rev-parse origin/feat/benchmark-acceptance-scorecard)"
WT="$(mktemp -d)/bench-wt"
cleanup() { git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT
git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null
# Dependencies come from the pinned commit itself, never the shared checkout (its lockfile can differ).
(cd "$WT/mira-hub" && npm ci --no-audit --no-fund --loglevel=error)
shasum -a 256 "$WT/mira-hub/package-lock.json" > "$OUT/$SET_NAME-lockfile.sha256"

echo "$SHA" > "$OUT/$SET_NAME-sha.txt"
shasum -a 256 "$QUESTIONS" > "$OUT/$SET_NAME-inputs.sha256"

for k in 10 6; do
  for arm in off on; do
    flag=0
    [ "$arm" = on ] && flag=1
    (cd "$WT/mira-hub" && NOTEBOOK_LEXICAL_V2="$flag" npx vite-node --config vitest.config.ts \
      ../tools/benchmark-acceptance/retrieval_rank.ts -- "$arm" "$k" "$QUESTIONS" "$OUT/$SET_NAME-$arm-k$k.jsonl")
  done
  cat "$OUT/$SET_NAME-off-k$k.jsonl" "$OUT/$SET_NAME-on-k$k.jsonl" > "$OUT/$SET_NAME-k$k.jsonl"
  ext_args=()
  [ -n "$EXTERNAL" ] && ext_args=(--external "$EXTERNAL")
  python3 "$WT/tools/benchmark-acceptance/scorecard.py" "$OUT/$SET_NAME-k$k.jsonl" "${ext_args[@]}" \
    --out "$OUT/$SET_NAME-k$k-scorecard.json" --md "$OUT/$SET_NAME-k$k-scorecard.md"
done
