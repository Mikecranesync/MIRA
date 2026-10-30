#!/bin/bash
# Pinned IMIB harness (retrieval_rank.ts sha256 12ced03b…5f07), production flags, zero tokens.
P=/private/tmp/claude-501/-Users-charlienode/4b76b48e-7f5a-40d6-9cdd-bbe606e67dc3/scratchpad/t1/proof
export BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
run() { # arm-label worktree set k rep
  cd $2/mira-hub || exit 1
  npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_rank.ts -- off $4 ../tools/bench4589/$3-questions.json $P/$3-$1-k$4-r$5.jsonl 2>&1 | grep -v "^Warning: TT" | tail -1
}
for arm in "base /Users/charlienode/MIRA-worktrees/t1-base" "cand /Users/charlienode/MIRA-worktrees/t1-fix"; do set -- $arm
  for s in forum-new forum-fresh; do for k in 10 6; do for r in 1 2 3; do run $1 $2 $s $k $r; done; done; done
done
for arm in "base /Users/charlienode/MIRA-worktrees/t1-base" "cand /Users/charlienode/MIRA-worktrees/t1-fix"; do set -- $arm
  for s in t4-77 oem-fault oem-index robust; do run $1 $2 $s 10 1; done
done
cd /Users/charlienode/MIRA-worktrees/t1-fix && git rev-parse HEAD > $P/cand-sha.txt && git -C /Users/charlienode/MIRA-worktrees/t1-base rev-parse HEAD > $P/base-sha.txt && shasum -a 256 tools/bench4589/retrieval_rank.ts tools/bench4589/forum-new-questions.json tools/bench4589/forum-fresh-questions.json > $P/inputs.sha256
echo PROOF-DONE
