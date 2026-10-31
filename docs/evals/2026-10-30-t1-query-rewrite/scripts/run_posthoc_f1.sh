#!/bin/bash
# Re-measure rewrite-only after the Codex F1 fix (rewrite rows no longer count as lexical coverage).
set -u
S=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1
HUB=$HOME/MIRA-worktrees/t1-rewrite/mira-hub
Q=$HOME/MIRA-worktrees/t1-rewrite/tools/bench4589
mkdir -p "$S"/posthoc-f1
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
export REWRITES_JSON=$HOME/MIRA/.planning/2026-10-29-t1-fix/rewrite/rewrites.json
cd "$HUB" || exit 1
for set in forum-fresh2 forum-fresh3 oem-fault oem-index t4-77 forum-fresh forum-new; do
  out="$S/posthoc-f1/$set-rewrite-only-k10.jsonl"
  [ -s "$out" ] || BENCH_SET=$set npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- rewrite 10 "$Q/$set-questions.json" "$out" 2>&1 | grep -v "^Warning: TT" | tail -1
done
echo POSTHOC-F1-DONE
