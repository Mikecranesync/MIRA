#!/usr/bin/env bash
# graphify code-graph auto-refresh — regenerate against origin/main, commit the
# 3 artifacts, push to main. Self-maintaining fix for the drift (render.py never
# committed graph.json). Safe to run anytime: works in an isolated worktree, so
# it never touches ~/MIRA's working tree; aborts without committing on Gemini 403.
# Ref: wiki/orchestrator/kg/README.md
set -uo pipefail

REPO="$HOME/MIRA"
WT="/tmp/mira-kg-wt"
RUN="/tmp/mira-kg-build"
GFY="$HOME/.local/bin/graphify"
DOP="$HOME/.local/bin/doppler"

cd "$REPO" || { echo "no repo"; exit 1; }
git fetch origin --quiet || { echo "fetch failed"; exit 1; }
MAINSHA="$(git rev-parse --short origin/main)"
echo "refreshing graph against origin/main @ $MAINSHA"

# isolated clean checkout of origin/main (does NOT disturb ~/MIRA working tree)
git worktree remove --force "$WT" 2>/dev/null
git worktree add --detach "$WT" origin/main >/dev/null 2>&1 || { echo "worktree add failed"; exit 1; }

# stage scoped modules with the README exclude list
rm -rf "$RUN"; mkdir -p "$RUN/scope/mira-bots" "$RUN/scope/mira-hub"
EXCL=(--exclude __pycache__ --exclude '*.pyc' --exclude .git --exclude node_modules \
  --exclude dist --exclude .next --exclude build --exclude coverage \
  --exclude __tests__ --exclude __mocks__ --exclude __snapshots__ \
  --exclude '*.test.ts' --exclude '*.test.tsx' --exclude '*.spec.ts' --exclude '*.spec.tsx' \
  --exclude '*.stories.tsx' --exclude e2e --exclude fixtures --exclude '*.map' --exclude messages)
rsync -a "${EXCL[@]}" "$WT/mira-bots/shared/" "$RUN/scope/mira-bots/shared/"
rsync -a "${EXCL[@]}" "$WT/mira-hub/src/"     "$RUN/scope/mira-hub/src/"
rsync -a "${EXCL[@]}" "$WT/mira-pipeline/"    "$RUN/scope/mira-pipeline/"
rsync -a "${EXCL[@]}" "$WT/mira-mcp/"         "$RUN/scope/mira-mcp/"

# Key-free STRUCTURAL refresh: `graphify update` re-extracts code files (AST —
# no LLM/Gemini key needed) and updates the existing graph in place. Doppler is
# keyring-locked over SSH and env.brain's key 400s, so we skip the semantic
# (LLM) pass; structural edges (calls/imports/containment) are what
# explain/affected/path use. Semantic edges are preserved from the last full run.
# `update` reads/writes <path>/graphify-out/graph.json, so seed it from the
# committed graph first.
OUT="$RUN/scope/graphify-out"
mkdir -p "$OUT"
cp "$WT/wiki/orchestrator/kg/graph.json" "$OUT/graph.json"
export GRAPHIFY_NO_BACKUP=1
echo "--- update (AST, no LLM) ---"
"$GFY" update "$RUN/scope" --force --no-cluster 2>&1 | tail -8

if [ ! -s "$OUT/graph.json" ]; then
  echo "UPDATE_FAILED (graph.json missing/empty). No commit."
  cd "$REPO"; git worktree remove --force "$WT" 2>/dev/null
  exit 2
fi

cp "$OUT/graph.json" "$WT/wiki/orchestrator/kg/graph.json"
cd "$WT"
git add wiki/orchestrator/kg/graph.json wiki/orchestrator/kg/graph.html wiki/orchestrator/kg/GRAPH_REPORT.md
if git diff --cached --quiet; then
  echo "no graph change vs main — nothing to commit"; cd "$REPO"; git worktree remove --force "$WT"; exit 0
fi
git -c user.name="graphify-bot" -c user.email="ops@factorylm.com" \
  commit -q -m "chore(graphify): auto-refresh code graph @ $MAINSHA"
# push, with one rebase-retry if main moved
if ! git push origin HEAD:main 2>&1 | tail -2; then
  git fetch origin --quiet && git rebase origin/main && git push origin HEAD:main 2>&1 | tail -2
fi
NEW="$(git rev-parse --short HEAD)"
cd "$REPO"; git worktree remove --force "$WT" 2>/dev/null
NODES="$(grep -o '"id"' "$OUT/graph.json" | wc -l | tr -d ' ')"
echo "DONE: graph refreshed to $MAINSHA, pushed as $NEW, ~$NODES nodes"
