#!/bin/bash
# ONE run of the frozen arm (PREREG-rewrite-round.md) + the declared ablation on the held-out sets.
set -u
S=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1
HUB=$HOME/MIRA-worktrees/t1-rewrite/mira-hub
Q=$HOME/MIRA-worktrees/t1-rewrite/tools/bench4589
mkdir -p "$S"/heldout
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
export NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=3
cd "$HUB" || exit 1
for set in forum-fresh2 forum-fresh3; do
  out=$S/heldout/$set-frozen-k10.jsonl
  [ -s "$out" ] || REWRITES_JSON=$HOME/MIRA/.planning/2026-10-29-t1-fix/rewrite/rewrites.json BENCH_SET=$set \
    npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- hybrid+rewrite 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
  out=$S/heldout/$set-ablation-hybrid-lw3-k10.jsonl
  [ -s "$out" ] || BENCH_SET=$set \
    npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- hybrid 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
done
python3 "$S/score.py" "$S"/heldout/*-k10.jsonl | grep -v miss
echo HELDOUT-DONE
