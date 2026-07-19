#!/usr/bin/env bash
# CodeGraph preflight — the mandatory per-task navigation gate.
# Ref: .claude/rules/codegraph-usage.md, wiki/references/codegraph.md.
#
# Run this BEFORE any non-doc coding task. It is cheap (status + canary +
# freshness, a few seconds) and prints a short markdown report you paste into
# the PR's "CodeGraph preflight" section. The benchmark (tools/codegraph-
# benchmark.sh) is the heavier periodic check — preflight is the per-task gate.
#
# Usage:
#   tools/codegraph-preflight.sh ["task description"]
#
# With a task description it also runs `codegraph context` and flags any
# shared module in the result that needs a `codegraph impact` before editing.
#
# Exit codes:
#   0  READY      — index present, fresh, canary healthy
#   1  STALE      — index older than HEAD / sync marker behind / canary repaired
#   2  BROKEN     — index missing or npx unavailable (stop; init/sync first)

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 2

CG=(npx -y @colbymchenry/codegraph)
TASK="${1:-}"

# Freshness helpers (cg_newer_indexed_sources) — excludes generated / dependency
# / cache / nested-worktree paths so build artifacts don't produce false STALE.
# shellcheck source=tools/codegraph-freshness.sh
. "$SCRIPT_DIR/codegraph-freshness.sh"

# Shared modules: a codegraph_impact is required before editing any of these.
SHARED_RE='engine\.py|inference/router\.py|uns_resolver\.py|citation_compliance\.py|guardrails\.py|crawler/ingest/uns\.py|mira-mcp/server\.py'

strip() { sed $'s/\x1b\\[[0-9;]*m//g'; }
ec=0  # worst exit code seen

echo "## CodeGraph preflight"
echo ""

# ---- Environment ----------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
if command -v npx >/dev/null 2>&1; then NPX=ok; else NPX=MISSING; ec=2; fi
VER="$( "${CG[@]}" --version 2>/dev/null | strip | tail -1 )"
MCP=$(grep -q '"codegraph"' "$REPO_ROOT/.mcp.json" 2>/dev/null && echo "wired" || echo "NOT in .mcp.json")

echo "- **Branch / HEAD:** \`$BRANCH\` @ \`$HEAD_SHA\`"
echo "- **CodeGraph CLI:** ${VER:-unknown} · **npx:** $NPX · **MCP server:** $MCP"

# ---- Index presence + status ---------------------------------------------
if [ ! -d "$REPO_ROOT/.codegraph" ] || [ ! -f "$REPO_ROOT/.codegraph/codegraph.db" ]; then
  echo "- **Index:** ❌ MISSING (.codegraph/codegraph.db not found)"
  echo ""
  echo "> **STOP — BROKEN.** No index in this checkout (fresh clone or worktree)."
  echo "> Run: \`npx -y @colbymchenry/codegraph init -i\` (first time) or \`index --force\`."
  exit 2
fi

DB=".codegraph/codegraph.db"
DB_ISO="$(stat -f %Sm -t %Y-%m-%dT%H:%M:%S "$DB" 2>/dev/null || echo '?')"
STATUS="$( "${CG[@]}" status 2>/dev/null | strip )"
NODES="$(echo "$STATUS" | grep -iE 'Nodes:' | grep -oE '[0-9,]+' | head -1)"
EDGES="$(echo "$STATUS" | grep -iE 'Edges:' | grep -oE '[0-9,]+' | head -1)"
echo "- **Index:** present — nodes ${NODES:-?}, edges ${EDGES:-?}, db mtime \`$DB_ISO\`"

# ---- Freshness ------------------------------------------------------------
STALE=0
# (a) any indexed-language source file newer than the index db. This is
# precise: a docs-only commit won't flag the CODE index stale, but a
# checkout/merge (git stamps files at checkout time) or an uncommitted edit
# will. cg_newer_indexed_sources excludes generated / dependency / cache /
# nested-worktree paths (`.next/`, `node_modules/`, `.audit-worktrees/`, …) that
# CodeGraph never indexes — otherwise a Next.js build or an ad-hoc worktree
# produces a false STALE verdict on an index that is actually current.
NEWER="$(cg_newer_indexed_sources "$DB" . 2>/dev/null | head -1)"
if [ -n "$NEWER" ]; then
  echo "- **Freshness:** ⚠ source files are newer than the index (e.g. \`${NEWER#./}\`) — re-sync before trusting call edges"
  STALE=1
fi
# (b) sync marker behind current HEAD (written by post-merge/post-checkout)
MARKER="$REPO_ROOT/.codegraph/.last-sync"
if [ -f "$MARKER" ]; then
  M_HEAD="$(grep -E '^head=' "$MARKER" | cut -d= -f2)"
  M_CANARY="$(grep -E '^canary=' "$MARKER" | cut -d= -f2)"
  M_TS="$(grep -E '^ts=' "$MARKER" | cut -d= -f2)"
  FULL_HEAD="$(git rev-parse HEAD 2>/dev/null)"
  if [ -n "$M_HEAD" ] && [ "$M_HEAD" != "$FULL_HEAD" ]; then
    echo "- **Sync marker:** ⚠ last hook sync was at \`${M_HEAD:0:7}\` (≠ current HEAD) @ $M_TS"
    STALE=1
  else
    echo "- **Sync marker:** ✓ last hook sync at HEAD @ ${M_TS:-?} (canary: ${M_CANARY:-?})"
  fi
else
  echo "- **Sync marker:** none yet (hooks not run on this checkout, or first run)"
fi
# (c) uncommitted code edits the watcher may not have indexed
DIRTY_FILES="$(git diff --name-only -- '*.py' '*.ts' '*.tsx' 2>/dev/null)"
DIRTY="$(printf '%s\n' "$DIRTY_FILES" | grep -c .)"
if [ "${DIRTY:-0}" -gt 0 ]; then
  echo "- **Uncommitted code files:** $DIRTY changed — re-query after the watcher settles (~1s) or \`sync\`"
  # Affected tests for the changed files (codegraph affected <files...>). The
  # unquoted expansion is intentional: each path becomes a separate CLI arg.
  # shellcheck disable=SC2086
  AFF="$( "${CG[@]}" affected $DIRTY_FILES 2>/dev/null | strip \
    | grep -oE '[A-Za-z0-9_./-]*test[A-Za-z0-9_./-]*\.(py|ts|tsx)' | sort -u | head -8 )"
  [ -n "$AFF" ] && echo "- **Affected tests** (\`codegraph affected\`): $(printf '%s' "$AFF" | tr '\n' ' ')"
fi

# ---- Health canary --------------------------------------------------------
CANOUT="$("$SCRIPT_DIR/codegraph-canary.sh" 2>&1)"; CRC=$?
CLINE="$(echo "$CANOUT" | tail -1)"
case "$CRC" in
  0) echo "- **Canary:** ✓ ${CLINE##*canary: }" ;;
  1) echo "- **Canary:** ⚠ ${CLINE##*canary: } (auto-repaired via index --force)"; STALE=1 ;;
  *) echo "- **Canary:** ❌ ${CLINE##*canary: }"; ec=2 ;;
esac

# ---- Graphify guard (WARN only; see .claude/rules/graphify-excluded.md) ----
if [ -f "$REPO_ROOT/graphify-out/graph.json" ]; then
  echo "- **⚠ GRAPHIFY:** a repo-root \`graphify-out/graph.json\` exists. Graphify is **excluded from code navigation** (\`.claude/rules/graphify-excluded.md\`). Use CodeGraph; ignore this artifact for navigation."
fi

# ---- Task context ---------------------------------------------------------
if [ -n "$TASK" ]; then
  echo ""
  echo "### Task context — \"$TASK\""
  CTX="$( "${CG[@]}" context "$TASK" 2>/dev/null | strip )"
  SYMS="$(echo "$CTX" | grep -oE '[A-Za-z0-9_]+\.(py|ts|tsx):[0-9]+' | sort -u | head -12)"
  if [ -n "$SYMS" ]; then
    echo "Entry points / relevant locations from \`codegraph context\`:"
    echo '```'
    echo "$SYMS"
    echo '```'
    HOT="$(echo "$SYMS" | grep -E "$SHARED_RE" | sed -E 's/:[0-9]+$//' | sort -u)"
    if [ -n "$HOT" ]; then
      echo "**Shared module(s) in scope — run \`codegraph impact\` before editing:**"
      echo "$HOT" | awk '{print "- "$0}'
    fi
  else
    echo "_No structured locations surfaced — query \`codegraph_context\` / \`codegraph_search\` directly._"
  fi
fi

# ---- Known blind spots (always verify these with grep) --------------------
echo ""
echo "### Known blind spots — do NOT trust CodeGraph alone here"
echo "- **Class instantiation** (\`ClassName()\`): not a caller edge. \`callers <Class>\` / \`impact <Class>\` miss instantiation sites → cross-check \`grep -rn 'ClassName('\`. (upstream colbymchenry/codegraph#774)"
echo "- **Import-alias calls** (\`from m import f as _f\` → \`_f()\`): \`callers f\` returns 0 → grep the alias."
echo "- **Same-name symbols:** \`callers/callees/trace\` aggregate across all defs (\"aggregated across N\") — can't scope to one; grep the specific file."

# ---- Verdict --------------------------------------------------------------
echo ""
if [ "$ec" -ge 2 ]; then
  echo "> **VERDICT: BROKEN — stop and fix the index before editing.**"; exit 2
elif [ "$STALE" -eq 1 ]; then
  echo "> **VERDICT: STALE — \`npx -y @colbymchenry/codegraph sync\` (or \`index --force\`) then re-run, before trusting results.**"; exit 1
else
  echo "> **VERDICT: READY — CodeGraph is fresh and healthy. Proceed; honor the blind spots above.**"; exit 0
fi
