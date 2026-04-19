#!/usr/bin/env bash
# MIRA Garbage Collection — prune stale branches, artifacts, Docker resources.
#
# Usage:
#   bash tools/gc.sh              # dry-run (show what would be cleaned)
#   bash tools/gc.sh --execute    # actually delete
#
# Safe to run on any node (Alpha, Bravo, Charlie).

set -uo pipefail

EXECUTE=0
[[ "${1:-}" == "--execute" ]] && EXECUTE=1

DELETED_BRANCHES=0
DELETED_ARTIFACTS=0
RECOVERED_BYTES=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

header() { echo -e "\n${GREEN}=== $1 ===${NC}"; }
dry()    { echo -e "${YELLOW}[dry-run]${NC} $1"; }
act()    { echo -e "${GREEN}[delete]${NC} $1"; }

# ---------------------------------------------------------------------------
# 1. Merged remote branches (except main, dev)
# ---------------------------------------------------------------------------
header "Merged remote branches"

git fetch --prune origin 2>/dev/null || true

MERGED_BRANCHES=$(git branch -r --merged origin/main 2>/dev/null \
    | grep 'origin/' \
    | grep -v 'origin/main$' \
    | grep -v 'origin/dev$' \
    | grep -v 'origin/HEAD' \
    | sed 's|origin/||' \
    | tr -d ' ' || true)

if [[ -z "$MERGED_BRANCHES" ]]; then
    echo "  No merged branches to clean."
else
    for branch in $MERGED_BRANCHES; do
        if [[ $EXECUTE -eq 1 ]]; then
            git push origin --delete "$branch" 2>/dev/null && act "origin/$branch" || echo "  skip: origin/$branch (delete failed)"
        else
            dry "would delete origin/$branch"
        fi
        DELETED_BRANCHES=$((DELETED_BRANCHES + 1))
    done
fi

# ---------------------------------------------------------------------------
# 2. Old worktree branches (>14 days, merged only)
# ---------------------------------------------------------------------------
header "Stale worktree branches (merged, >14 days)"

WORKTREE_BRANCHES=$(git branch -r --merged origin/main 2>/dev/null \
    | grep 'origin/worktree-' \
    | sed 's|origin/||' \
    | tr -d ' ' || true)

# Already covered by step 1, just count them separately for reporting
WT_COUNT=0
for branch in $WORKTREE_BRANCHES; do
    WT_COUNT=$((WT_COUNT + 1))
done
echo "  $WT_COUNT worktree branches included in merged branch cleanup above."

# ---------------------------------------------------------------------------
# 3. Test artifacts (.coverage, .pytest_cache, __pycache__)
# ---------------------------------------------------------------------------
header "Test artifacts"

ARTIFACT_PATTERNS=(
    ".coverage"
    ".pytest_cache"
    "htmlcov"
    ".hypothesis"
)

for pattern in "${ARTIFACT_PATTERNS[@]}"; do
    FOUND=$(find . -name "$pattern" -not -path './.git/*' 2>/dev/null || true)
    for item in $FOUND; do
        SIZE=$(du -sh "$item" 2>/dev/null | cut -f1 || echo "?")
        if [[ $EXECUTE -eq 1 ]]; then
            rm -rf "$item" && act "$item ($SIZE)"
        else
            dry "would remove $item ($SIZE)"
        fi
        DELETED_ARTIFACTS=$((DELETED_ARTIFACTS + 1))
    done
done

# __pycache__ directories
PYCACHE_COUNT=$(find . -name "__pycache__" -not -path './.git/*' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$PYCACHE_COUNT" -gt 0 ]]; then
    if [[ $EXECUTE -eq 1 ]]; then
        find . -name "__pycache__" -not -path './.git/*' -exec rm -rf {} + 2>/dev/null || true
        act "$PYCACHE_COUNT __pycache__ directories"
    else
        dry "would remove $PYCACHE_COUNT __pycache__ directories"
    fi
    DELETED_ARTIFACTS=$((DELETED_ARTIFACTS + PYCACHE_COUNT))
fi

# ---------------------------------------------------------------------------
# 4. Docker cleanup (dangling images + old build cache)
# ---------------------------------------------------------------------------
header "Docker cleanup"

if command -v docker &>/dev/null; then
    DANGLING=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l | tr -d ' ')
    echo "  Dangling images: $DANGLING"

    if [[ $EXECUTE -eq 1 && "$DANGLING" -gt 0 ]]; then
        docker image prune -f --filter "until=168h" 2>/dev/null && act "pruned dangling images (>7 days)"
        docker builder prune -f --filter "until=168h" 2>/dev/null && act "pruned build cache (>7 days)"
    elif [[ "$DANGLING" -gt 0 ]]; then
        dry "would prune $DANGLING dangling images + build cache (>7 days)"
    fi
else
    echo "  Docker not available — skipping."
fi

# ---------------------------------------------------------------------------
# 5. Stale lock files
# ---------------------------------------------------------------------------
header "Stale lock files"

STALE_LOCKS=0
for lock in /tmp/mira_*.lock; do
    [[ ! -f "$lock" ]] && continue
    # Check if older than 1 hour (3600 seconds)
    if [[ $(find "$lock" -mmin +60 2>/dev/null) ]]; then
        if [[ $EXECUTE -eq 1 ]]; then
            rm -f "$lock" && act "$lock"
        else
            dry "would remove $lock (stale >1h)"
        fi
        STALE_LOCKS=$((STALE_LOCKS + 1))
    fi
done
[[ $STALE_LOCKS -eq 0 ]] && echo "  No stale locks found."

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
header "Summary"
echo "  Merged branches:  $DELETED_BRANCHES"
echo "  Test artifacts:   $DELETED_ARTIFACTS"
echo "  Stale locks:      $STALE_LOCKS"
if [[ $EXECUTE -eq 0 ]]; then
    echo ""
    echo -e "  ${YELLOW}Dry run — nothing was deleted.${NC}"
    echo "  Run with --execute to apply changes."
fi
