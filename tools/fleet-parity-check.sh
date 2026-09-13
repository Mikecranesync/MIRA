#!/usr/bin/env bash
# fleet-parity-check.sh — read-only drift check for the FactoryLM fleet standard.
#
# Inspects; never owns or mutates (docs/agent-standard/rollout.md Phase 5: "a future shared
# parity check should inspect, not own, the system"). It verifies that the canonical standard
# exists and that every provider entry point links to it, then prints the §11 verdict at an
# exact commit so a closeout can cite it.
#
#   usage: tools/fleet-parity-check.sh [--repo <path>] [--node <alpha|bravo|charlie|...>]
#   exit:  0 = STANDARD   2 = PARTIAL (only node-overlay checks differ)   1 = FAIL
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

# 2. Entry points link to the standard ("link, do not duplicate" — rollout.md Phase 2)
for f in AGENTS.md CLAUDE.md .claude/CLAUDE.md .claude/rules/fleet-standard.md; do
  if [ ! -f "$f" ]; then
    flunk "entry point: $f missing" "UNIVERSAL DRIFT"
  elif grep -qF "$STD" "$f"; then
    pass "entry point: $f links to $STD"
  else
    flunk "entry point: $f does not link to $STD" "UNIVERSAL DRIFT"
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

# 5. Verdict at an exact commit (§11: parity evidence is recorded at an exact commit)
echo "---"
echo "repo:   $REPO"
echo "head:   $HEAD_SHA"
echo "checks: $total  fail: $fail  node-diff: $partial"
if [ "$fail" -gt 0 ]; then
  echo "VERDICT: FAIL"; exit 1
elif [ "$partial" -gt 0 ]; then
  echo "VERDICT: PARTIAL"; exit 2
else
  echo "VERDICT: STANDARD"; exit 0
fi
