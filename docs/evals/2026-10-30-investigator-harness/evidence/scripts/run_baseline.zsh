#!/bin/zsh
# Frozen production baseline: arm off, topK 10, clean origin/main 524106a06 (sparse worktree, no uncommitted diff).
set -u
W=$HOME/MIRA-worktrees/investigator; D=$HOME/MIRA/.planning/2026-10-30-investigator-harness/baseline
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
cd $W/mira-hub
echo "HEAD $(git rev-parse HEAD) dirty-src=$(git status --porcelain -- src | wc -l)"
for set in forum-fresh forum-new forum-fresh2 forum-fresh3 t4-77 oem-fault oem-index; do
  out=$D/$set-off-k10.jsonl
  [ -s "$out" ] || env -u OPENAI_API_KEY BENCH_SET=$set npx vite-node --config vitest.config.ts ../tools/investigator/bench/retrieval_dev.ts -- off 10 $D/$set-questions.json $out 2>&1 | grep -v "^Warning: TT" | tail -1
done
shasum -a 256 $D/*-off-k10.jsonl > $D/sha256.txt
echo BASELINE-DONE
