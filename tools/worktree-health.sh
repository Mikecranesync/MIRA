#!/usr/bin/env bash
# tools/worktree-health.sh — DETECTION ONLY worktree health report.
#
# Reports the failure modes catalogued in docs/tech-debt/2026-07-27-worktree-clutter-rca.md:
#   1. more than one worktree holding `main`   (the RCA's highest-severity failure:
#      git allows ONE checkout per branch with no TTL, so a forgotten worktree
#      blocks the shared checkout — this happened 2026-07-27)
#   2. registered worktrees whose path no longer exists
#   3. worktrees whose branch ref is gone, or detached HEADs unreachable from any
#      ref (their commits become GC-eligible the moment the worktree is removed)
#   4. unusually old worktrees
#   5. accumulation under the MIRA-wt/ parent dir
#   6. owner/purpose, inferred where discoverable
#
# ⚠️ THIS SCRIPT NEVER DELETES, PRUNES, UNLOCKS, OR MODIFIES ANYTHING.
# That is deliberate, not an oversight. `git branch --merged` is a weak signal in
# this repo because it squash-merges, so an automated sweep would eventually
# delete live unpushed work. A human reads this and decides. See the RCA § 4.
#
# Always exits 0 so a cron/launchd line like `worktree-health.sh && something`
# is never broken by a finding. Use --strict to exit 1 when findings exist.
#
# Usage:
#   tools/worktree-health.sh                # report
#   tools/worktree-health.sh --strict       # exit 1 if any finding (for CI)
#   MIRA_WT_MAX_AGE_DAYS=14 tools/...       # override the "old" threshold (default 30)
#   MIRA_WT_PARENT=~/MIRA-wt tools/...      # override the watched parent dir

set -u

MAX_AGE_DAYS="${MIRA_WT_MAX_AGE_DAYS:-30}"
WT_PARENT="${MIRA_WT_PARENT:-$HOME/MIRA-wt}"
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { echo "worktree-health: cannot cd to $REPO_ROOT"; exit 0; }

# The canonical checkout = the worktree that is the repo root itself.
MAIN_CHECKOUT="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||')"
[ -n "$MAIN_CHECKOUT" ] || MAIN_CHECKOUT="$REPO_ROOT"

FINDINGS=0
note() { FINDINGS=$((FINDINGS + 1)); printf '  %s\n' "$*"; }

# ---- collect ---------------------------------------------------------------
# tab-separated: path \t branch(or -) \t head \t locked(0/1)
WT_TSV="$(git worktree list --porcelain 2>/dev/null | awk '
  /^worktree /{ if(p!="") print p"\t"(b==""?"-":b)"\t"h"\t"l; p=substr($0,10); b=""; h=""; l=0 }
  /^HEAD /{ h=substr($0,6) }
  /^branch /{ b=substr($0,8); sub(/^refs\/heads\//,"",b) }
  /^detached/{ b="(detached)" }
  /^locked/{ l=1 }
  END{ if(p!="") print p"\t"(b==""?"-":b)"\t"h"\t"l }')"

TOTAL="$(printf '%s\n' "$WT_TSV" | grep -c . )"

echo "# Worktree health — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""
echo "Repo: $REPO_ROOT · registered worktrees: $TOTAL · canonical checkout: $MAIN_CHECKOUT"
echo "DETECTION ONLY — this report never removes anything."
echo ""

# ---- 1. multiple holders of main -------------------------------------------
echo "## 1. Holders of \`main\`"
MAIN_HOLDERS="$(printf '%s\n' "$WT_TSV" | awk -F'\t' '$2=="main"{print $1}')"
MAIN_COUNT="$(printf '%s\n' "$MAIN_HOLDERS" | grep -c . )"
if [ "$MAIN_COUNT" -eq 0 ]; then
  note "⚠ no worktree holds \`main\` — the canonical checkout is on another branch."
elif [ "$MAIN_COUNT" -eq 1 ]; then
  H="$(printf '%s\n' "$MAIN_HOLDERS")"
  if [ "$H" = "$MAIN_CHECKOUT" ]; then
    echo "  ✓ exactly one, and it is the canonical checkout."
  else
    note "⚠ \`main\` is held by $H, NOT the canonical checkout ($MAIN_CHECKOUT) — the canonical checkout cannot check out main while this exists."
  fi
else
  note "❌ $MAIN_COUNT worktrees hold \`main\`:"
  printf '%s\n' "$MAIN_HOLDERS" | sed 's/^/      /'
fi
echo ""

# ---- 2. missing paths ------------------------------------------------------
echo "## 2. Registered but missing on disk"
MISSING=0
while IFS="$(printf '\t')" read -r p b h l; do
  [ -n "${p:-}" ] || continue
  if [ ! -d "$p" ]; then
    MISSING=$((MISSING + 1))
    if [ "$l" = "1" ]; then
      note "❌ MISSING + LOCKED — \`git worktree prune\` will SKIP this: $p [$b]"
    else
      note "⚠ missing (prunable): $p [$b]"
    fi
  fi
done <<EOF
$WT_TSV
EOF
[ "$MISSING" -eq 0 ] && echo "  ✓ none."
echo ""

# ---- 3. orphaned branch / unreachable detached HEAD ------------------------
echo "## 3. Orphaned refs"
ORPH=0
while IFS="$(printf '\t')" read -r p b h l; do
  [ -n "${p:-}" ] || continue
  if [ "$b" = "(detached)" ] || [ "$b" = "-" ]; then
    # a detached HEAD reachable from no ref becomes GC-eligible once removed
    if [ -n "${h:-}" ] && ! git for-each-ref --contains "$h" --format='%(refname)' 2>/dev/null | grep -q .; then
      ORPH=$((ORPH + 1)); note "⚠ detached HEAD ${h:0:8} reachable from NO ref — removing this worktree makes those commits GC-eligible: $p"
    fi
  elif ! git show-ref --verify --quiet "refs/heads/$b"; then
    ORPH=$((ORPH + 1)); note "❌ branch ref \`$b\` no longer exists but a worktree still claims it: $p"
  fi
done <<EOF
$WT_TSV
EOF
[ "$ORPH" -eq 0 ] && echo "  ✓ none."
echo ""

# ---- 4. unusually old ------------------------------------------------------
echo "## 4. Older than ${MAX_AGE_DAYS} days"
OLD=0
NOW="$(date +%s)"
while IFS="$(printf '\t')" read -r p b h l; do
  [ -n "${p:-}" ] || continue
  [ "$p" = "$MAIN_CHECKOUT" ] && continue
  [ -d "$p" ] || continue
  BIRTH="$(stat -f %B "$p" 2>/dev/null || stat -c %W "$p" 2>/dev/null || echo 0)"
  [ "${BIRTH:-0}" -gt 0 ] 2>/dev/null || continue
  AGE=$(( (NOW - BIRTH) / 86400 ))
  if [ "$AGE" -ge "$MAX_AGE_DAYS" ]; then
    OLD=$((OLD + 1))
    DIRTY="clean"; [ -n "$(git -C "$p" status --porcelain 2>/dev/null | head -1)" ] && DIRTY="DIRTY"
    note "⚠ ${AGE}d old · $DIRTY · [$b] $p"
  fi
done <<EOF
$WT_TSV
EOF
[ "$OLD" -eq 0 ] && echo "  ✓ none."
echo ""

# ---- 5. MIRA-wt/ accumulation ---------------------------------------------
echo "## 5. Accumulation under $WT_PARENT"
if [ -d "$WT_PARENT" ]; then
  N="$(find "$WT_PARENT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$N" -eq 0 ]; then
    echo "  ✓ empty."
  else
    note "⚠ $N entr$([ "$N" = 1 ] && echo y || echo ies) left under $WT_PARENT:"
    find "$WT_PARENT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's/^/      /'
  fi
else
  echo "  ✓ parent dir does not exist."
fi
echo ""

# ---- 6. owner / purpose ----------------------------------------------------
echo "## 6. Inventory with inferred owner"
printf '  %-4s %-34s %-30s %s\n' "AGE" "OWNER (inferred)" "BRANCH" "PATH"
while IFS="$(printf '\t')" read -r p b h l; do
  [ -n "${p:-}" ] || continue
  case "$p" in
    "$MAIN_CHECKOUT") own="canonical checkout" ;;
    */.claude/worktrees/*) own="Claude Code agent isolation" ;;
    */.audit-worktrees/*) own="audit run" ;;
    */.codex/worktrees/*) own="Codex CLI" ;;
    */Documents/Codex/*) own="Codex session" ;;
    /tmp/*|/private/tmp/*) own="ad-hoc /tmp" ;;
    /sessions/*) own="remote/cloud sandbox" ;;
    "$WT_PARENT"/*) own="ad-hoc MIRA-wt" ;;
    *) own="ad-hoc / unknown" ;;
  esac
  if [ -d "$p" ]; then
    BIRTH="$(stat -f %B "$p" 2>/dev/null || echo 0)"
    if [ "${BIRTH:-0}" -gt 0 ] 2>/dev/null; then age="$(( (NOW - BIRTH) / 86400 ))d"; else age="?"; fi
  else
    age="GONE"
  fi
  printf '  %-4s %-34s %-30s %s\n' "$age" "$own" "${b:0:29}" "$p"
done <<EOF
$WT_TSV
EOF
echo ""

# ---- summary ---------------------------------------------------------------
if [ "$FINDINGS" -eq 0 ]; then
  echo "> **HEALTHY** — $TOTAL worktree(s), no findings."
else
  echo "> **$FINDINGS finding(s)** across $TOTAL worktree(s). Nothing was changed."
  echo "> Review each before acting. Do NOT bulk-delete: \`--merged\` is a weak signal"
  echo "> here (squash-merge), and a dirty worktree may hold the only copy of work."
fi

[ "$STRICT" -eq 1 ] && [ "$FINDINGS" -gt 0 ] && exit 1
exit 0
