#!/usr/bin/env bash
# fleet-parity-check.sh — read-only drift check for the FactoryLM fleet standard.
#
# Inspects; never owns or mutates (docs/agent-standard/rollout.md Phase 5: "a future shared
# parity check should inspect, not own, the system"). It verifies ONE thing: that the canonical
# standard exists and that every provider entry point in the repository links to it — the
# adapter WIRING. That is one input to the FLEET_STANDARD.md §11 machine verdict
# (STANDARD / PARTIAL / FAIL), never that verdict itself: §11 also needs a health-checked
# CodeGraph, wiki access, Git identity/auth, worktree compliance, verification commands, and
# managed secrets, none of which a file scan can prove. So this script deliberately uses a
# vocabulary that cannot be mistaken for §11:
#
#   usage: tools/fleet-parity-check.sh [--repo <path>] [--node <alpha|bravo|charlie|...>]
#   exit:  0 = WIRING-OK   2 = WIRING-OK-NODE-GAPS (only node-overlay files differ)   1 = WIRING-BROKEN
#
# Bash 3.2-compatible on purpose (macOS ships 3.2); no associative arrays, no mapfile.
# Fixed-string greps only — `grep -E '\b'` matches nothing on this platform.

set -u

REPO=""
NODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --node) NODE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -z "$REPO" ] && REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO" || { echo "FAIL cannot cd to $REPO"; exit 1; }

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
STD="docs/agent-standard/FLEET_STANDARD.md"
fail=0; partial=0; total=0

pass() { total=$((total+1)); printf 'PASS  %s\n' "$1"; }
flunk() { total=$((total+1)); fail=$((fail+1)); printf 'FAIL  %s  [%s]\n' "$1" "$2"; }
soft() { total=$((total+1)); partial=$((partial+1)); printf 'DIFF  %s  [%s]\n' "$1" "$2"; }

# 1. Canonical files (UNIVERSAL — absent means no agent on any node can follow the standard)
for f in "$STD" docs/agent-standard/rollout.md docs/agent-standard/README.md \
         docs/agent-standard/providers/claude.md docs/agent-standard/providers/codex.md; do
  if [ -f "$f" ]; then pass "canonical: $f"; else flunk "canonical: $f missing" "UNIVERSAL DRIFT"; fi
done

# 2. Entry points link to the standard ("link, do not duplicate" — rollout.md Phase 2).
#    AGENTS.md is the provider-neutral root map and must link the standard itself; root
#    CLAUDE.md is a thin adapter that reaches it by importing AGENTS.md (`@AGENTS.md`), so the
#    check there is the import, not a second copy of the link.
for f in AGENTS.md .claude/CLAUDE.md .claude/rules/fleet-standard.md; do
  if [ ! -f "$f" ]; then
    flunk "entry point: $f missing" "UNIVERSAL DRIFT"
  elif grep -qF "$STD" "$f"; then
    pass "entry point: $f links to $STD"
  else
    flunk "entry point: $f does not link to $STD" "UNIVERSAL DRIFT"
  fi
done
if [ ! -f CLAUDE.md ]; then
  flunk "entry point: CLAUDE.md missing" "UNIVERSAL DRIFT"
elif grep -qxF '@AGENTS.md' CLAUDE.md; then
  if [ -f AGENTS.md ]; then
    pass "entry point: CLAUDE.md imports AGENTS.md (@AGENTS.md)"
  else
    flunk "entry point: CLAUDE.md imports AGENTS.md but AGENTS.md is missing" "UNIVERSAL DRIFT"
  fi
else
  flunk "entry point: CLAUDE.md does not import AGENTS.md (expected a line reading exactly '@AGENTS.md')" "UNIVERSAL DRIFT"
fi
# A thin adapter that grows back into a map is the drift this whole layout exists to prevent.
n=$(wc -l < CLAUDE.md | tr -d ' ')
if [ "$n" -le 80 ]; then pass "CLAUDE.md is a thin adapter ($n lines)"; else flunk "CLAUDE.md is $n lines — adapter budget is 80; project truth belongs in AGENTS.md or its targets" "UNIVERSAL DRIFT"; fi
n=$(wc -l < AGENTS.md | tr -d ' ')
if [ "$n" -le 160 ]; then pass "AGENTS.md is a bootloader ($n lines)"; else flunk "AGENTS.md is $n lines — bootloader budget is 160; deep detail belongs in canonical docs" "UNIVERSAL DRIFT"; fi

# 2b. Every docs/agent-standard/*.md path an entry point names must resolve. A pointer to a file
#     that does not exist is the same defect as the old '.Codex/skills/' — green text, dead link.
#     No here-document and no temp file here on purpose: in a sandbox with no writable TMPDIR a
#     here-document fails, bash skips the loop, and this section silently vanishes from the
#     verdict (found by the #3761 round-1 review). The extracted charset cannot contain
#     whitespace, so a newline-IFS for-loop over a variable is exact and needs no I/O.
for f in AGENTS.md CLAUDE.md .claude/CLAUDE.md .claude/rules/fleet-standard.md; do
  [ -f "$f" ] || continue
  paths=$(grep -oE 'docs/agent-standard/[A-Za-z0-9_/.-]+\.md' "$f" | sort -u)
  found=0
  oldifs=$IFS; IFS='
'
  for p in $paths; do
    found=$((found+1))
    if [ -f "$p" ]; then pass "resolves: $f -> $p"; else flunk "dangling: $f -> $p" "UNIVERSAL DRIFT"; fi
  done
  IFS=$oldifs
  # A file that links the standard must yield at least that one path; zero means the scan itself
  # failed (not "nothing to check"), and a scan that fails must not pass by producing nothing.
  if grep -qF "$STD" "$f" && [ "$found" -eq 0 ]; then
    flunk "scan produced no paths for $f although it links $STD — checker infrastructure failure" "UNIVERSAL DRIFT"
  fi
done

# 3. Known-false statements that once lived in AGENTS.md (the April 2026 s/Claude/Codex/ fork).
#    Each is a literal that contradicts root CLAUDE.md § Hard Constraints or names a path that
#    does not exist. Re-appearance means the stale corpus came back.
if [ -f AGENTS.md ]; then
  for marker in "Anthropic Codex API" "Gemini → Groq" ".Codex/skills" "→ Anthropic API" "Groq/Codex"; do
    if grep -qF -- "$marker" AGENTS.md; then
      flunk "AGENTS.md carries a known-false statement: '$marker'" "UNIVERSAL DRIFT"
    else
      pass "AGENTS.md free of '$marker'"
    fi
  done
fi

# 4. Node overlay (NODE — a valid machine-specific difference, never a FAIL by itself)
if [ -z "$NODE" ]; then
  case "$(hostname 2>/dev/null)" in
    CharlieNodes*) NODE=charlie ;;
    FactoryLM-Bravo*) NODE=bravo ;;
    Michaels-Mac-mini-2*) NODE=alpha ;;
  esac
fi
if [ -n "$NODE" ]; then
  for f in "docs/agent-standard/nodes/$NODE.md" "wiki/nodes/$NODE.md"; do
    if [ -f "$f" ]; then pass "node overlay: $f"; else soft "node overlay: $f missing" "NODE OVERLAY"; fi
  done
else
  soft "node overlay: node not identified (pass --node)" "NODE OVERLAY"
fi

# 5. Verdict at an exact commit (§11 asks that parity evidence be recorded at an exact commit;
#    this is the wiring slice of that evidence).
#    Floor: sections 1–4 always emit at least this many checks on a real tree (5 canonical +
#    4 entry points + 2 budgets + ≥4 resolved paths + 5 markers + 2 node = 22). Fewer means a
#    section was skipped, and a checker that can pass by skipping is not a checker.
MIN_CHECKS=22
if [ "$total" -lt "$MIN_CHECKS" ]; then
  flunk "only $total checks ran (floor $MIN_CHECKS) — a section was skipped; infrastructure failure, not compliance" "UNIVERSAL DRIFT"
fi
echo "---"
echo "repo:   $REPO"
echo "head:   $HEAD_SHA"
echo "checks: $total  fail: $fail  node-diff: $partial"
echo "scope:  repository adapter wiring only — one input to FLEET_STANDARD.md §11, not the §11 machine verdict"
if [ "$fail" -gt 0 ]; then
  echo "VERDICT: WIRING-BROKEN"; exit 1
elif [ "$partial" -gt 0 ]; then
  echo "VERDICT: WIRING-OK-NODE-GAPS"; exit 2
else
  echo "VERDICT: WIRING-OK"; exit 0
fi
