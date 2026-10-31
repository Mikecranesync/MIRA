#!/bin/bash
# Merge/rewrite experiments on the three dev sets. Zero paid tokens: rewrites come from the cache.
set -u
S=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1
HUB=$HOME/MIRA-worktrees/t1-rewrite/mira-hub
Q=$HOME/MIRA-worktrees/t1-rewrite/tools/bench4589
mkdir -p "$S"/exp
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
export REWRITES_JSON=$HOME/MIRA/.planning/2026-10-29-t1-fix/rewrite/rewrites.json
cd "$HUB" || exit 1
run() { # name arm envs...
  local name=$1 arm=$2; shift 2
  for set in forum-fresh forum-new t4-77; do
    local out="$S/exp/$name-$set-k10.jsonl"
    [ -s "$out" ] && continue
    env BENCH_SET=$set "$@" npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- "$arm" 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
  done
  python3 "$S/score.py" "$S"/exp/"$name"-*-k10.jsonl | grep -v miss
}
run rw-split      rewrite        BENCH_REWRITE_SPLIT=1
run hr-vecrw      hybrid+rewrite NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_VECTOR_TEXT=rewrite
run hr-veccat     hybrid+rewrite NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_VECTOR_TEXT=concat
run hr-lw2        hybrid+rewrite NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=2
run hr-lw3        hybrid+rewrite NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=3
run h-lw2         hybrid         NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=2
run hr-vecrw-lw2  hybrid+rewrite NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_VECTOR_TEXT=rewrite BENCH_RRF_LEX_WEIGHT=2
echo ALL-DONE
