#!/bin/bash
# Frozen arm (PREREG-rewrite-round.md) once on the regression sets. Waits for the held-out run to finish first.
set -u
S=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1
HUB=$HOME/MIRA-worktrees/t1-rewrite/mira-hub
Q=$HOME/MIRA-worktrees/t1-rewrite/tools/bench4589
mkdir -p "$S"/heldout
until grep -q HELDOUT-DONE "$S/heldout.log"; do sleep 20; done
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
export NOTEBOOK_HYBRID_RETRIEVAL=1 BENCH_RRF_LEX_WEIGHT=3 REWRITES_JSON=$HOME/MIRA/.planning/2026-10-29-t1-fix/rewrite/rewrites.json
cd "$HUB" || exit 1
# Regression questions have no rewrite in the cache (they are not forum posts); the harness reports the count.
for set in oem-fault oem-index robust; do
  out=$S/heldout/$set-frozen-k10.jsonl
  [ -s "$out" ] || BENCH_SET=$set npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- hybrid+rewrite 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
done
echo REGRESSION-DONE
