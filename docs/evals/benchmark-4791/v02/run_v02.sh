#!/usr/bin/env bash
# IMIB v0.2 retrieval arms: k=6 (production call), 2 repeats, production flags, then the planted defect.
#   BENCH_PG=postgres://bench:bench@127.0.0.1:55450/bench bash v02/run_v02.sh <worktree-root> <out-dir> <set>...
# <worktree-root> holds wt-<rev>/ (npm ci done, tools/bench4589/retrieval_rank.ts from c095b54c1). Sequential: the harness
# keys its tenant on arm+topK. The planted defect edits ONE line in wt-cc0d26c1d and restores it on every exit path.
set -euo pipefail
ROOT="${1:?worktree root}"; OUT="${2:?out}"; shift 2
: "${BENCH_PG:?BENCH_PG}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
F=mira-hub/src/lib/manual-rag.ts
restore() { git -C "$ROOT/wt-cc0d26c1d" checkout -- "$F"; }
trap restore EXIT
run() {  # rev tag set repeat
  local q="$HERE/$3/$3-questions.json"
  (cd "$ROOT/wt-$1/mira-hub" && env -u NOTEBOOK_HYBRID_RETRIEVAL -u NOTEBOOK_RERANK NOTEBOOK_LEXICAL_V2=0 BENCH_PG="$BENCH_PG" \
    npx vite-node --config vitest.config.ts ../tools/bench4589/retrieval_rank.ts -- off 6 "$q" "$OUT/$3/$3-$2-k6-r$4.jsonl") \
    > "$OUT/$3/$3-$2-k6-r$4.log" 2>&1
  echo "$3 $2 r$4: $(wc -l < "$OUT/$3/$3-$2-k6-r$4.jsonl") rows"
}
for SET in "$@"; do
  mkdir -p "$OUT/$SET"
  for rev in b980d42db e28bb182d cc0d26c1d; do for r in 1 2; do run "$rev" "$rev" "$SET" "$r"; done; done
done
python3 - "$ROOT/wt-cc0d26c1d/$F" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '  const runExactLane = async (patterns: string[], match: "ilike" | "regex" = "ilike") => {\n    if (patterns.length === 0) return [];'
assert s.count(old) == 1, "anchor"
open(p, "w").write(s.replace(old, '  const runExactLane = async (patterns: string[], match: "ilike" | "regex" = "ilike") => {\n    return []; // IMIB PLANTED DEFECT'))
PY
for SET in "$@"; do for r in 1 2; do run cc0d26c1d cc0d26c1d-noexactlane "$SET" "$r"; done; done
restore
git -C "$ROOT/wt-cc0d26c1d" diff --quiet -- "$F" && echo "planted defect reverted"
