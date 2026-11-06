#!/usr/bin/env bash
# Paired revision A/B of notebook retrieval, zero tokens, production flags.
#   BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench \
#     bash run_ab.sh <set-name> <questions.json> <out-dir> <worktree-root> [repeats]
# <worktree-root> holds wt-<rev>/ detached worktrees (one `npm ci` each) and tools/bench4589/ = the pinned
# #4589 harness (c095b54c1). Every revision runs the SAME harness bytes, the SAME inputs, NOTEBOOK_LEXICAL_V2=0,
# and no hybrid/rerank (production parity, the harness refuses otherwise). Runs are sequential: the
# harness keys its tenant on arm+topK, so concurrent runs would collide.
set -euo pipefail
SET="${1:?set}"; Q="${2:?questions}"; OUT="${3:?out}"; ROOT="${4:?worktree root}"; REPEATS="${5:-3}"
: "${BENCH_PG:?BENCH_PG}"
mkdir -p "$OUT"
shasum -a 256 "$Q" > "$OUT/$SET-inputs.sha256"
for rev in b980d42db e28bb182d cc0d26c1d; do
  git -C "$ROOT/wt-$rev" rev-parse HEAD > "$OUT/$SET-$rev-sha.txt"
  shasum -a 256 "$ROOT/wt-$rev/tools/bench4589/retrieval_rank.ts" "$ROOT/wt-$rev/mira-hub/package-lock.json" > "$OUT/$SET-$rev-harness.sha256"
  for k in 10 6; do
    for r in $(seq 1 "$REPEATS"); do
      (cd "$ROOT/wt-$rev/mira-hub" && env -u NOTEBOOK_HYBRID_RETRIEVAL -u NOTEBOOK_RERANK NOTEBOOK_LEXICAL_V2=0 BENCH_PG="$BENCH_PG" \
        npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_rank.ts -- off "$k" "$Q" "$OUT/$SET-$rev-k$k-r$r.jsonl") \
        > "$OUT/$SET-$rev-k$k-r$r.log" 2>&1
      echo "$SET $rev k$k r$r: $(wc -l < "$OUT/$SET-$rev-k$k-r$r.jsonl") rows"
    done
  done
done
