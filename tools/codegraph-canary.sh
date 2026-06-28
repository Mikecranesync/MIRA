#!/usr/bin/env bash
# CodeGraph corruption canary.
# Ref: docs/tech-debt/2026-06-09-codegraph-evaluation.md §4 + recommendation #3.
#
# The incremental file-watcher silently drops call edges (264 `FOREIGN KEY
# constraint failed` errors observed in daemon.log), so the hot files the
# MIRA rules tell you to trust — chiefly engine.py — progressively lose their
# call edges while `codegraph status` and `codegraph sync` keep reporting
# "healthy". This canary turns that silent failure into a self-healing one.
#
# How it works:
#   * Query the callers of a known-good hot-file symbol (`resolve_uns_path`,
#     which has ~20 real callers across engine.py + dialogue_*).
#   * 0 callers  -> index is corrupt -> run `index --force` to repair, re-check.
#   * >0 callers -> index is healthy.
#
# `sync` does NOT repair a corrupted edge set; only `index --force` does. That
# is why the repair path here is a full reindex, not a sync.
#
# Exit codes:
#   0  healthy            (callers found, no repair needed; or codegraph absent -> skip)
#   1  repaired           (corruption detected AND force-reindex restored callers)
#   2  repair failed      (still 0 callers after force-reindex, or reindex errored)
#
# Designed to be safe in a git hook: never blocks, degrades to a clean skip
# when codegraph / npx isn't present.

set -u

# Make npx/node resolvable under launchd, cron, and restricted hook shells
# (their PATH is the bare /usr/bin:/bin and would miss Homebrew's node).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Run from the repo root so the .codegraph index in CWD is the one queried.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 0

CG=(npx -y @colbymchenry/codegraph)
CANARY_SYMBOL="resolve_uns_path"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }
log() { echo "[$(ts)] codegraph-canary: $*"; }

# --- Graceful skips (never fail a merge / scheduled run) -------------------
if [ ! -d ".codegraph" ]; then
  log "skip — .codegraph not present in $REPO_ROOT"
  exit 0
fi
if ! command -v npx >/dev/null 2>&1; then
  log "skip — npx unavailable"
  exit 0
fi

# Count callers of the canary symbol. The CLI prints a header line like
#   Callers of "resolve_uns_path" (20):
# We strip ANSI colour codes, pull the parenthesised count off that header,
# and default to 0 when the header is absent ("No callers found" / error).
count_callers() {
  "${CG[@]}" callers "$CANARY_SYMBOL" 2>/dev/null \
    | sed $'s/\x1b\\[[0-9;]*m//g' \
    | grep -Eo 'Callers of "[^"]*" \([0-9]+\)' \
    | grep -Eo '[0-9]+' \
    | head -1
}

n="$(count_callers)"
n="${n:-0}"

if [ "$n" -gt 0 ] 2>/dev/null; then
  log "healthy — $n callers of $CANARY_SYMBOL"
  exit 0
fi

# --- Corruption detected: repair with a full reindex ----------------------
log "CORRUPT — 0 callers of $CANARY_SYMBOL; repairing with 'index --force'"
if ! "${CG[@]}" index --force >/dev/null 2>&1; then
  log "repair FAILED — 'index --force' returned non-zero"
  exit 2
fi

n="$(count_callers)"
n="${n:-0}"
if [ "$n" -gt 0 ] 2>/dev/null; then
  log "repaired — $n callers of $CANARY_SYMBOL after force-reindex"
  exit 1
fi

log "repair FAILED — still 0 callers of $CANARY_SYMBOL after force-reindex"
exit 2
