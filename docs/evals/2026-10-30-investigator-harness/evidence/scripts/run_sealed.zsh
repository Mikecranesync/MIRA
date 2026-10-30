#!/bin/zsh
# ONE run of every pre-registered arm on the sealed sets (PREREGISTRATION.md §6). Requires FROZEN line in sealed/SEALED.md.
# Paid calls (H0/H1/H2 synthesis, B1 rewrites) all reserve against ONE ledger with a $5 hard cap.
set -u
H=$HOME/MIRA/.planning/2026-10-30-investigator-harness; W=$HOME/MIRA-worktrees/investigator; T1=$HOME/MIRA-worktrees/t1-rewrite
S=$H/sealed; O=$H/sealed-runs; LEDGER=$H/spend-ledger.jsonl
F=$S/forum/forum-sealed4-questions.json; C=$S/scenarios/sealed-c-cases.json; R=$O/r80.json
grep -q "FROZEN" $S/SEALED.md || { echo "not frozen — refusing"; exit 1; }
FROZEN=$(grep FROZEN $S/SEALED.md | tail -1 | sed -E 's/.*sha=([0-9a-f]+).*/\1/'); HEAD=$(git -C $W rev-parse HEAD)
[ "$FROZEN" = "$HEAD" ] || { echo "HEAD $HEAD != FROZEN $FROZEN — refusing"; exit 1; }
[ -z "$(git -C $W status --porcelain -- mira-hub/src tools/investigator)" ] || { echo "worktree dirty — refusing"; exit 1; }
export OLLAMA_BASE_URL=http://localhost:11434 BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench
cd $W/mira-hub; echo "start $(date -u +%FT%TZ) head=$HEAD"
# 0. ingest the sealed forum set into its own new tenant (INSERT-only, refuses existing sets)
env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/investigator/ingest.ts -- forum-sealed4 $F 2>&1 | grep -v "^Warning: TT" | tail -2
# 1. Workstream B on SEALED-F ($0 arms)
[ -s $O/fs4-off-k10.jsonl ] || BENCH_SET=forum-sealed4 env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/investigator/bench/retrieval_dev.ts -- off 10 $F $O/fs4-off-k10.jsonl 2>&1 | grep -v "^Warning: TT" | tail -1
for arm in b0p b2 b4; do [ -s $O/fs4-$arm-k10.jsonl ] || BENCH_SET=forum-sealed4 env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/investigator/fusion_arms.ts -- $arm 10 $F $O/fs4-$arm-k10.jsonl 2>&1 | grep -v "^Warning: TT" | tail -1; done
# 2. B1 rewrite arm: rewrites for the sealed questions (paid, cached), run on the #4983 tree that carries rewrittenQuery
cp $H/../2026-10-29-t1-fix/rewrite/rewrites.json $O/rewrites-sealed.json 2>/dev/null || true
before=$(python3 -c "import json;print(json.load(open('$O/rewrites-sealed.json'))['spent_usd'])")
REWRITE_BUDGET_USD=0.25 doppler run -p factorylm -c dev -- python3 $T1/tools/bench4589/rewrite_queries.py $O/rewrites-sealed.json $F 2>&1 | tail -2
after=$(python3 -c "import json;print(json.load(open('$O/rewrites-sealed.json'))['spent_usd'])")
# rewrite_queries.py keeps its own cumulative counter (it inherited the #4983 round's $0.1394); book only THIS run's delta
# into the shared $5 ledger so one file holds every paid call of this mission.
python3 -c "import json,time;d=$after-$before;open('$LEDGER','a').write(json.dumps({'type':'reserve','id':'rewrite-sealed4','worstCaseUsd':d,'label':'B1 rewrites forum-sealed4 (rewrite_queries.py)','ts':int(time.time()*1000)})+'\n'+json.dumps({'type':'settle','id':'rewrite-sealed4','actualUsd':d,'inputTokens':0,'outputTokens':0,'ts':int(time.time()*1000)})+'\n');print('rewrite delta USD',round(d,5))"
[ -s $O/fs4-rewrite-k10.jsonl ] || (cd $T1/mira-hub && REWRITES_JSON=$O/rewrites-sealed.json BENCH_SET=forum-sealed4 env -u OPENAI_API_KEY npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_hybrid_dev.ts -- rewrite 10 $F $O/fs4-rewrite-k10.jsonl 2>&1 | grep -v "^Warning: TT" | tail -1)
# 3. Harness arms H0/H1/H2 on SEALED-F, SEALED-C, R-80 (paid, one ledger, $5 cap)
for set in fs4:$F sc:$C r80:$R; do name=${set%%:*}; file=${set#*:}
  for arm in H0 H1 H2; do out=$O/$name-$arm.jsonl
    [ -s $out ] || doppler run -p factorylm -c dev -- env OLLAMA_BASE_URL=$OLLAMA_BASE_URL BENCH_PG=$BENCH_PG npx vite-node --config vitest.config.ts ../tools/investigator/run_cases.ts -- $arm $file $out --ledger $LEDGER --cap 5 2>&1 | grep -v "^Warning: TT" | tail -1
  done; done
shasum -a 256 $O/*.jsonl > $O/sha256.txt; echo "SEALED-RUNS-DONE $(date -u +%FT%TZ)"
