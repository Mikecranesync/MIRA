#!/usr/bin/env bash
# CodeGraph benchmark suite — repeatable, fail-loud, two-tier.
# Ref: docs/tech-debt/2026-06-09-codegraph-evaluation.md + 2026-06-10-rebenchmark.
#
# Tier-1 (GATES exit code): the symbols that previously suffered silent
#   corruption must return correct callers (floors + known-caller-file
#   presence, not brittle exact counts); coverage resolves; canary healthy;
#   the stale-detection logic works. No case may silently skip.
# Tier-2 (REPORTED, does not gate by itself): the known, documented blind
#   spots (class instantiation, import-alias, same-name aggregation). These
#   are "wrong by design" today, so failing on them would make the suite
#   permanently red. We assert their EXPECTED state and fail loud only if
#   one REGRESSES (a good case breaks) or RESOLVES (surface → update docs/#774).
#
# Usage:  tools/codegraph-benchmark.sh [output.md]
#   default output: docs/tech-debt/<YYYY-MM-DD>-codegraph-benchmark.md
#
# Exit: 0 all Tier-1 pass & no Tier-2 regression · 1 a Tier-1 failed or a
#       Tier-2 case regressed · 2 environment broken (no index / no npx).

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 2
CG=(npx -y @colbymchenry/codegraph)
OUT="${1:-docs/tech-debt/$(date +%F)-codegraph-benchmark.md}"

command -v npx >/dev/null 2>&1 || { echo "BROKEN: npx unavailable"; exit 2; }
[ -f "$REPO_ROOT/.codegraph/codegraph.db" ] || { echo "BROKEN: no .codegraph index"; exit 2; }

strip() { sed $'s/\x1b\\[[0-9;]*m//g'; }
callers_raw() { "${CG[@]}" callers "$1" 2>/dev/null | strip; }
# count = the parenthesised number in the header (symbol name is in quotes)
count_of() { echo "$1" | grep -Eo '\([0-9]+\)' | tr -d '()' | head -1; }
has_file() { echo "$1" | grep -q "$2"; }

T1_PASS=0; T1_FAIL=0; T2_NOTE=0; T2_REGRESS=0
ROWS_T1=""; ROWS_T2=""; ROWS_COV=""

# ---- Tier-1: corruption-regression call-graph cases -----------------------
# args: symbol  floor  must_contain(file, optional)
t1_callers() {
  local sym="$1" floor="$2" needle="${3:-}"
  local raw n verdict; raw="$(callers_raw "$sym")"; n="$(count_of "$raw")"; n="${n:-0}"
  if [ "$n" -ge "$floor" ] 2>/dev/null && { [ -z "$needle" ] || has_file "$raw" "$needle"; }; then
    verdict="✅ PASS"; T1_PASS=$((T1_PASS+1))
  else
    verdict="❌ FAIL"; T1_FAIL=$((T1_FAIL+1))
  fi
  ROWS_T1+="| \`$sym\` | callers ≥ $floor${needle:+, incl. $needle} | $n${needle:+, $(has_file "$raw" "$needle" && echo "has $needle" || echo "MISSING $needle")} | $verdict |
"
}
t1_callers resolve_uns_path        5 engine.py     # was 0 on stale index
t1_callers _should_fire_uns_gate   1 engine.py     # unique method, was 0
t1_callers _maybe_dispatch_via_dst 1 engine.py     # unique method, was 0
t1_callers _make_result            1 engine.py     # was wrong-twin only

# ---- Tier-1: coverage (symbol resolves to a real location) ----------------
cov() {
  local sym="$1" raw loc
  raw="$( "${CG[@]}" query "$sym" 2>/dev/null | strip )"
  loc="$(echo "$raw" | grep -oE '[A-Za-z0-9_./-]+\.(py|ts|tsx):[0-9]+' | head -1)"
  if [ -n "$loc" ]; then ROWS_COV+="| \`$sym\` | $loc | ✅ |
"; T1_PASS=$((T1_PASS+1)); else ROWS_COV+="| \`$sym\` | — | ❌ |
"; T1_FAIL=$((T1_FAIL+1)); fi
}
for s in Supervisor classify_intent resolve_uns_path InferenceRouter \
         check_citation_compliance withTenantContext sessionOr401 ingest_batch; do cov "$s"; done

# ---- Tier-1: canary --------------------------------------------------------
"$SCRIPT_DIR/codegraph-canary.sh" >/dev/null 2>&1; CRC=$?
if [ "$CRC" -le 1 ]; then CAN="✅ healthy/repaired (rc=$CRC)"; T1_PASS=$((T1_PASS+1)); else CAN="❌ repair failed (rc=$CRC)"; T1_FAIL=$((T1_FAIL+1)); fi

# ---- Tier-1: stale-detection logic (deterministic, non-destructive) -------
# Backdate the db mtime → preflight must report STALE (exit 1) → restore mtime.
DB="$REPO_ROOT/.codegraph/codegraph.db"
touch -t 200001010000 "$DB" 2>/dev/null
"$SCRIPT_DIR/codegraph-preflight.sh" >/dev/null 2>&1; PRC=$?
touch "$DB" 2>/dev/null   # restore to now (content untouched; only mtime moved)
if [ "$PRC" -eq 1 ]; then STALE_T="✅ preflight flagged STALE on backdated index (exit 1)"; T1_PASS=$((T1_PASS+1));
else STALE_T="❌ preflight did NOT flag a backdated index (exit $PRC)"; T1_FAIL=$((T1_FAIL+1)); fi

# ---- Tier-1: MCP/CLI parity (best-effort spike, documented fallback) ------
CLI_RUP="$(count_of "$(callers_raw resolve_uns_path)")"; CLI_RUP="${CLI_RUP:-0}"
MCP_RUP="$(printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"b","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"codegraph_callers","arguments":{"symbol":"resolve_uns_path"}}}' \
 | timeout 20 "${CG[@]}" serve --mcp 2>/dev/null | tr '\r' '\n' \
 | grep -oE 'resolve_uns_path \([0-9]+ found\)|\([0-9]+ found\)' | grep -oE '[0-9]+' | head -1 )"
if [ -n "$MCP_RUP" ]; then
  if [ "$MCP_RUP" = "$CLI_RUP" ]; then PARITY="✅ MCP==CLI ($MCP_RUP) via stdio JSON-RPC"; T1_PASS=$((T1_PASS+1));
  else PARITY="❌ MCP ($MCP_RUP) ≠ CLI ($CLI_RUP)"; T1_FAIL=$((T1_FAIL+1)); fi
else
  # Documented fallback: stdio handshake collides with the running daemon and
  # is not reliably scriptable. CLI and daemon read the SAME .codegraph DB, so
  # divergence can only come from daemon in-memory staleness, which the
  # preflight freshness check catches. In-session MCP check this dev cycle:
  # codegraph_callers resolve_uns_path == 20 == CLI.
  PARITY="➖ MCP stdio spike not scriptable vs running daemon — structural parity (shared DB) + preflight freshness is the standing detector (not gated)"
fi

# ---- Tier-2: known blind spots (expected state; fail only on change) -------
t2() {  # symbol  expected_count  label  ('resolve'-direction note)
  local sym="$1" exp="$2" label="$3" raw n verdict
  raw="$(callers_raw "$sym")"; n="$(count_of "$raw")"; n="${n:-0}"
  if [ "$n" -eq "$exp" ]; then
    verdict="✅ as-expected ($n) — $label"; T2_NOTE=$((T2_NOTE+1))
  elif [ "$n" -gt "$exp" ]; then
    verdict="🎉 RESOLVED ($n>$exp) — limitation gone; update docs + #774/#? "; T2_NOTE=$((T2_NOTE+1))
  else
    verdict="❌ REGRESSED ($n<$exp) — $label"; T2_REGRESS=$((T2_REGRESS+1))
  fi
  ROWS_T2+="| \`$sym\` | $exp (blind spot) | $n | $verdict |
"
}
t2 Supervisor                0 "class instantiation not edged (#774)"
# NOTE (2026-07-14): the former `t2 check_citation_compliance 0` case was RETIRED.
# It was never a clean import-alias probe and its count was polluted: on
# 2026-07-14 `callers check_citation_compliance` returned 11, but 10 were
# duplicate `.audit-worktrees/*/…/citation_compliance.py:315` copies (a
# non-gitignored nested worktree the index picked up) and only 1 was the real
# `mira-bots/shared/citation_compliance.py:315` — a genuine DIRECT caller
# (`enforce_citation_via_rewrite`), not the engine.py *aliased* call. The
# engine.py `_check_citation_compliance` alias still resolves to 0, so the
# import-alias blind spot is UNCHANGED. The worktree-pollution reporter below
# replaces this case. See docs/tech-debt/2026-07-14-codegraph-benchmark.md.
# same-name aggregation: `resolve_uns_path` is defined twice (uns_resolver.py
# + mira-mcp/kg_client.py); callers/callees/trace union across both and can't
# scope to one. Deterministic CLI signal = query returns ≥2 definition sites.
NDEFS="$( "${CG[@]}" query resolve_uns_path 2>/dev/null | strip \
  | grep -oE '[A-Za-z0-9_./-]+\.(py|ts|tsx):[0-9]+' | sort -u | wc -l | tr -d ' ')"
if [ "${NDEFS:-0}" -ge 2 ]; then ROWS_T2+="| same-name (\`resolve_uns_path\` ×N defs) | ≥2 defs, can't scope | $NDEFS defs | ✅ as-expected — callers union across defs; grep the file |
"; T2_NOTE=$((T2_NOTE+1)); else ROWS_T2+="| same-name (\`resolve_uns_path\` ×N defs) | ≥2 defs, can't scope | $NDEFS def | 🎉 only one def now — ambiguity gone, verify |
"; T2_NOTE=$((T2_NOTE+1)); fi

# ---- Tier-2: nested-worktree index pollution (reported; remediation = gitignore + reindex)
# CodeGraph respects .gitignore. A non-gitignored nested worktree (`.audit-worktrees/`,
# an ad-hoc `git worktree add` outside `.claude/worktrees/`) gets INDEXED, and every
# duplicate copy of a symbol is counted as an extra caller — silently inflating
# `callers`/`callees`/`impact`. Probe a symbol that exists in worktree copies and count
# how many callers come from a worktree path. Non-gating: the fix is a reindex after the
# offending dir is gitignored, which this suite can't force on a shared index.
# `callers` indents path lines with spaces, so match the fragment ANYWHERE on the
# line (no ^/ anchor — that was a false-"clean" bug caught 2026-07-14).
WT_HITS="$(callers_raw check_citation_compliance | grep -cE '(\.audit-worktrees|\.worktrees|\.claude/worktrees)/' )"
if [ "${WT_HITS:-0}" -eq 0 ]; then
  ROWS_T2+="| nested-worktree pollution | 0 worktree callers | clean | ✅ index excludes nested worktrees |
"; T2_NOTE=$((T2_NOTE+1))
else
  ROWS_T2+="| nested-worktree pollution | 0 worktree callers | $WT_HITS polluted | ⚠️ index includes nested-worktree copies — gitignore the dir + \`index --force\` (inflates caller counts) |
"; T2_NOTE=$((T2_NOTE+1))
fi

# ---- Verdict + write report -----------------------------------------------
EXIT=0
[ "$T1_FAIL" -gt 0 ] && EXIT=1
[ "$T2_REGRESS" -gt 0 ] && EXIT=1
VERDICT=$([ "$EXIT" -eq 0 ] && echo "✅ GREEN — Tier-1 all pass, no Tier-2 regression" || echo "❌ RED — Tier-1 failure or Tier-2 regression; investigate before trusting the call-graph")
HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null)"
VER="$( "${CG[@]}" --version 2>/dev/null | strip | tail -1 )"

mkdir -p "$(dirname "$OUT")"
{
echo "# CodeGraph Benchmark — $(date +%F)"
echo ""
echo "**Branch/HEAD:** \`$(git rev-parse --abbrev-ref HEAD)\` @ \`$HEAD_SHA\` · **CLI:** ${VER:-?} · generated by \`tools/codegraph-benchmark.sh\`"
echo ""
echo "## Verdict: $VERDICT"
echo ""
echo "Tier-1 pass: **$T1_PASS** · Tier-1 fail: **$T1_FAIL** · Tier-2 notes: $T2_NOTE · Tier-2 regressions: **$T2_REGRESS**"
echo ""
echo "## Tier-1 — call-graph regression guards (gating)"
echo "| Symbol | Expectation | Result | Verdict |"
echo "|---|---|---|---|"
printf '%s' "$ROWS_T1"
echo ""
echo "**Canary:** $CAN  "
echo "**Stale-detection:** $STALE_T  "
echo "**MCP/CLI parity:** $PARITY"
echo ""
echo "## Tier-1 — coverage (symbol resolves)"
echo "| Symbol | Location | OK |"
echo "|---|---|---|"
printf '%s' "$ROWS_COV"
echo ""
echo "## Tier-2 — known blind spots (reported; fail only on regression/resolution)"
echo "| Case | Expected | Now | Status |"
echo "|---|---|---|---|"
printf '%s' "$ROWS_T2"
echo ""
echo "> Tier-2 cases are limitations that \`grep\` covers (see \`.claude/rules/codegraph-usage.md\` blind spots). A 🎉 RESOLVED row means the limitation was fixed upstream — update the rules + close the relevant issue. A ❌ REGRESSED row means a previously-working relationship broke — treat as a real defect."
} > "$OUT"

echo "$VERDICT"
echo "Tier-1 pass=$T1_PASS fail=$T1_FAIL · Tier-2 notes=$T2_NOTE regress=$T2_REGRESS"
echo "Report: $OUT"
exit "$EXIT"
