#!/usr/bin/env bash
# BRAVO's latency replication request: topK 6 only, arm order off,on,on,off,off,on, uptime at each start.
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
REPO=/Users/charlienode/MIRA
SHA=9d22076c13072327eef32997d727edac84b74d7c
OUT=$REPO/.planning/bench-4589-dev/latency-rep
Q=$REPO/.planning/evidence-runoff-data/t4/questions.json
mkdir -p "$OUT"
WT="$(mktemp -d)/bench-wt"
cleanup() { git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT
git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null
(cd "$WT/mira-hub" && npm ci --no-audit --no-fund >/dev/null 2>&1)
unset NOTEBOOK_HYBRID_RETRIEVAL NOTEBOOK_RERANK
export BENCH_PG=postgres://bench@localhost:55432/t4
i=0
for arm in off on on off off on; do
  i=$((i+1)); flag=0; [ "$arm" = on ] && flag=1
  echo "rep$i $arm start $(date -u +%FT%TZ) uptime: $(uptime)" | tee -a "$OUT/uptime.log"
  (cd "$WT/mira-hub" && NOTEBOOK_LEXICAL_V2="$flag" npx vite-node --config vitest.config.ts \
    ../tools/benchmark-acceptance/retrieval_rank.ts -- "$arm" 6 "$Q" "$OUT/rep$i-$arm-k6.jsonl") 2>&1 | grep -v "TT: undefined" | tail -1
done
