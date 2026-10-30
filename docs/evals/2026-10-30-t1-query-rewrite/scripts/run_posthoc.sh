#!/bin/bash
# POST-HOC (disclosed, not pre-registered): rewrite-only arm, and the frozen arm re-run on the fault-code sets now that
# their questions have rewrites (as they would in production).
set -u
S=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1
HUB=$HOME/MIRA-worktrees/t1-rewrite/mira-hub
Q=$HOME/MIRA-worktrees/t1-rewrite/tools/bench4589
mkdir -p "$S"/posthoc
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
export REWRITES_JSON=$HOME/MIRA/.planning/2026-10-29-t1-fix/rewrite/rewrites.json
cd "$HUB" || exit 1
for set in forum-fresh2 forum-fresh3 oem-fault oem-index t4-77; do
  out=$S/posthoc/$set-rewrite-only-k10.jsonl
  [ -s "$out" ] || BENCH_SET=$set npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- rewrite 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
done
for set in oem-fault oem-index; do
  out=$S/posthoc/$set-frozen-with-rewrites-k10.jsonl
  [ -s "$out" ] || NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=3 BENCH_SET=$set npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- hybrid+rewrite 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
done
echo POSTHOC-DONE
