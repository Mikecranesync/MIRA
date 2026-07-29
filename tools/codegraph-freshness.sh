#!/usr/bin/env bash
# CodeGraph freshness helpers — sourceable library.
# Ref: .claude/rules/codegraph-usage.md, docs/tech-debt/2026-07-14-codegraph-benchmark.md.
#
# Two pure helpers, factored out of the preflight + force-reindex scripts so the
# regression tests (tests/test_codegraph_freshness.py) can exercise them without
# a live index or npx:
#
#   cg_newer_indexed_sources <db> [root]   -> prints indexed-language source
#       files newer than <db>, EXCLUDING generated / dependency / cache /
#       nested-worktree / build paths that CodeGraph never indexes. This is what
#       stops `.next/`, `.claude/worktrees/`, `.audit-worktrees/`, `node_modules/`
#       etc. from producing a false STALE verdict while still catching a
#       genuinely-modified `mira-*/**.py` or `.ts` source file.
#
#   cg_write_sync_marker <codegraph_dir> <event> <canary> [repo_root]
#       -> writes the `.last-sync` freshness marker in the canonical format the
#       preflight reads (ts/head/event/npx/index/canary). Used by
#       codegraph-force-reindex.sh so the daily reindex updates the marker
#       (previously only the git hooks did, so the marker lied after a reindex).
#
# Why exclude these paths: CodeGraph respects `.gitignore`, but any non-gitignored
# transient dir (a nested worktree created ad-hoc, a fresh build dir) would
# otherwise be scanned as "newer source". Excluding them here is defense-in-depth;
# the primary fix is keeping those dirs gitignored (see `.gitignore`).

# Directory basenames CodeGraph does not index (generated / deps / caches / worktrees).
# Kept in sync with `.gitignore`; edit both together.
CG_EXCLUDE_DIR_NAMES=(
  node_modules .git .codegraph .next .turbo .nuxt .svelte-kit
  dist build out coverage .coverage
  .venv venv env __pycache__ .pytest_cache .mypy_cache .ruff_cache .cache
  .audit-worktrees .worktrees graphify-out
  playwright-report test-results .parcel-cache .vite
)
# Full path fragments to prune (for nested dirs a bare -name can't target safely).
CG_EXCLUDE_PATH_GLOBS=(
  '*/.claude/worktrees/*'
  '*/.cleanup-rollback-*'
)

# Print indexed-language source files newer than <db>, excluding non-indexed paths.
# Usage: cg_newer_indexed_sources <db_path> [root_dir]
# Builds the find(1) prune as an ARGUMENT ARRAY (no eval / no %q word-splitting).
cg_newer_indexed_sources() {
  local db="$1" root="${2:-.}"
  [ -e "$db" ] || { echo "cg_newer_indexed_sources: db not found: $db" >&2; return 2; }
  local prune=() d g
  for d in "${CG_EXCLUDE_DIR_NAMES[@]}"; do
    prune+=( -o -type d -name "$d" )
  done
  for g in "${CG_EXCLUDE_PATH_GLOBS[@]}"; do
    prune+=( -o -path "$g" )
  done
  # "${prune[@]:1}" drops the leading -o so the group starts with a real predicate.
  find "$root" \( "${prune[@]:1}" \) -prune -o \
    \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) -type f -newer "$db" -print
}

# Write the canonical `.last-sync` freshness marker.
# Usage: cg_write_sync_marker <codegraph_dir> <event> <canary_status> [repo_root]
cg_write_sync_marker() {
  local cgdir="$1" event="$2" canary="$3" repo_root="${4:-$(pwd)}"
  [ -d "$cgdir" ] || return 1
  {
    echo "ts=$(date '+%Y-%m-%dT%H:%M:%S')"
    echo "head=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null)"
    echo "event=$event"
    echo "npx=ok"
    echo "index=present"
    echo "canary=$canary"
  } > "$cgdir/.last-sync" 2>/dev/null || return 1
}
