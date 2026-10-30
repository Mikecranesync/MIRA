#!/bin/zsh
# Workstream B arms on DEV + REGRESSION sets ($0): B0p/B2/B4 via fusion_arms.ts, B3 (rerank) via the pinned harness.
set -u
export DOCKER_HOST=unix:///Users/charlienode/.colima/default/docker.sock PATH="/opt/homebrew/bin:$PATH"
W=$HOME/MIRA-worktrees/investigator; H=$HOME/MIRA/.planning/2026-10-30-investigator-harness; Q=$H/baseline; O=$H/arms
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
cd $W/mira-hub; echo "HEAD $(git rev-parse HEAD) $(date -u +%FT%TZ)"
SETS=(forum-new forum-fresh forum-fresh2 forum-fresh3 t4-77 oem-fault oem-index)
for set in $SETS; do for arm in b0p b2 b4; do
  out=$O/$set-$arm-k10.jsonl
  [ -s "$out" ] || BENCH_SET=$set env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/investigator/fusion_arms.ts -- $arm 10 $Q/$set-questions.json $out 2>&1 | grep -v "^Warning: TT" | tail -1
done; done
# B3: local cross-encoder container (image already on disk; int8-avx2 = the bake-off's documented variant)
docker ps --format '{{.Names}}' | grep -qx inv-reranker || docker run -d --name inv-reranker -p 127.0.0.1:58089:8088 -e RERANKER_MODEL=int8-avx2 -e RERANKER_THREADS=3 mira-reranker:bench >/dev/null
for i in {1..60}; do curl -s -o /dev/null http://127.0.0.1:58089/ && break; sleep 2; done
docker inspect inv-reranker --format 'reranker image={{.Config.Image}} env={{json .Config.Env}}' | cut -c1-200
for set in $SETS; do
  out=$O/$set-rerank-k10.jsonl
  [ -s "$out" ] || NOTEBOOK_RERANK=1 RERANKER_URL=http://127.0.0.1:58089 BENCH_SET=$set env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/investigator/bench/retrieval_dev.ts -- rerank 10 $Q/$set-questions.json $out 2>&1 | grep -v "^Warning: TT" | tail -1
done
shasum -a 256 $O/*.jsonl > $O/sha256.txt; echo ARMS-DONE $(date -u +%FT%TZ)
