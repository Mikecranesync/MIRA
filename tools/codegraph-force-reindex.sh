#!/usr/bin/env bash
# CodeGraph full reindex — the only thing that repairs the call-edge
# corruption the incremental watcher introduces.
# Ref: docs/tech-debt/2026-06-09-codegraph-evaluation.md recommendation #1.
#
# `index --force` rebuilds the whole graph (~7 s on the ~1,400-file MIRA
# index — cheap enough to run routinely). `sync` is incremental and does
# NOT repair a damaged edge set, so a scheduled full reindex is the
# highest-leverage operational fix.
#
# Intended callers:
#   * the daily launchd job (tools/launchd/com.factorylm.codegraph-reindex.plist)
#   * a human running it by hand after a big merge or a corruption report
#
# Logs every step to stdout (the scheduler captures it). After reindexing it
# runs the corruption canary to prove the rebuild actually restored the call
# edges.
#
# Exit codes:
#   0  reindex succeeded and the canary confirms the call-graph is healthy
#   1  reindex ran but the canary still reports corruption
#   2  reindex command itself failed (or codegraph/npx absent)

set -u

# Make npx/node resolvable under launchd (bare PATH = /usr/bin:/bin).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 2

CG=(npx -y @colbymchenry/codegraph)

ts() { date '+%Y-%m-%dT%H:%M:%S'; }
log() { echo "[$(ts)] codegraph-force-reindex: $*"; }

if [ ! -d ".codegraph" ]; then
  log "skip — .codegraph not present in $REPO_ROOT"
  exit 0
fi
if ! command -v npx >/dev/null 2>&1; then
  log "skip — npx unavailable"
  exit 0
fi

log "starting 'index --force' in $REPO_ROOT"
start="$(date +%s)"
if ! "${CG[@]}" index --force; then
  log "FAILED — 'index --force' returned non-zero"
  exit 2
fi
elapsed="$(( $(date +%s) - start ))"
log "'index --force' completed in ${elapsed}s"

# Verify the rebuild with the corruption canary. A fresh index should report
# healthy (canary exit 0). Any other result means the rebuild didn't take.
log "verifying with corruption canary"
"$SCRIPT_DIR/codegraph-canary.sh"
rc=$?
case "$rc" in
  0)
    log "canary healthy — call-graph restored"
    exit 0
    ;;
  1)
    # Canary itself re-ran a reindex and recovered — unexpected right after a
    # fresh rebuild, but the end state is healthy.
    log "canary repaired on its own pass — call-graph healthy"
    exit 0
    ;;
  *)
    log "WARNING — canary still reports corruption after force-reindex"
    exit 1
    ;;
esac
