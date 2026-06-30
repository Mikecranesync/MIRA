#!/usr/bin/env bash
# test_judge.sh — hermetic tests for the dogfood judge's classification + the
# never-file-from-one-persona-alone gate. No live Hub, no GitHub: checks emit
# fixed verdicts and create_issue is shimmed. Run: bash tools/crew/dogfood/test_judge.sh
set -uo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
JUDGE="$HERE/judge.sh"
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "PASS: $1"; }
no(){ fail=$((fail+1)); echo "FAIL: $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
AUTH="$TMP/auth"; CHECKS="$TMP/checks"; RUNS="$TMP/runs"; REPORT="$TMP/report.md"
mkdir -p "$AUTH" "$CHECKS" "$RUNS"

# fake persona sessions (tok_for just needs a session-token cookie)
for p in finderp verifierp; do
  printf '{"cookies":[{"name":"next-auth.session-token","value":"tok-%s"}]}' "$p" > "$AUTH/$p-state.json"
done

# create_issue shim: prints a dup line if --search mentions DUPME, else a dry-run line
CI="$TMP/create_issue_shim.sh"
cat > "$CI" <<'SHIM'
#!/usr/bin/env bash
args="$*"
echo "==> Verification gate PASSED"
if printf '%s' "$args" | grep -q "DUPME"; then
  echo "Possible duplicates found:"
  echo "  #999 [OPEN] pre-existing"
else
  echo "DRY-RUN, would run:"
fi
SHIM
chmod +x "$CI"

mk(){ # name finder verifier dedupe body...
  local n="$1" f="$2" v="$3" dd="$4"; shift 4
  { echo "# shellcheck shell=bash disable=SC2034"
    echo "SCN_PATH=\"$n\""; echo "SCN_TITLE=\"t-$n\""; echo "SCN_IMPACT=\"impact-$n\""
    echo "SCN_LABELS=\"bug,dogfood,crew\""; echo "SCN_FINDER=\"$f\""; echo "SCN_VERIFIER=\"$v\""
    echo "SCN_DEDUPE=\"$dd\""
    echo "run_check(){ $* ; }"
  } > "$CHECKS/$n.check"
}

mk a_green   finderp verifierp "x" 'echo "GREEN: works"'
mk b_redboth finderp verifierp "x" 'echo "RED: broken"'
mk c_ambig   finderp verifierp "x" '[ "$DF_PERSONA" = "finderp" ] && echo "RED: broken" || echo "GREEN: fine"'
mk d_solo    finderp finderp   "x" 'echo "RED: broken"'
mk e_infra   finderp verifierp "x" 'echo "INFRA: unreachable"'
mk g_dup     finderp verifierp "DUPME term" 'echo "RED: broken"'

DF_AUTH_DIR="$AUTH" DF_CHECK_DIR="$CHECKS" DF_RUN_ROOT="$RUNS" \
  DF_CREATE_ISSUE="$CI" DF_REPORT="$REPORT" \
  bash "$JUDGE" --dry-run >/dev/null 2>&1

RES="$(ls -td "$RUNS"/dogfood-*/results.tsv | head -1)"
row(){ awk -F'\t' -v p="$1" '$2==p{print}' "$RES"; }
cls(){ row "$1" | awk -F'\t' '{print $1}'; }
conf(){ row "$1" | awk -F'\t' '{print $6}'; }
info(){ row "$1" | awk -F'\t' '{print $7}'; }

[ "$(cls a_green)" = "GREEN" ] && ok "green path classified GREEN" || no "green: got '$(cls a_green)'"
[ "$(cls b_redboth)" = "RED" ] && [ "$(conf b_redboth)" = "yes" ] && ok "RED confirmed by both personas" || no "redboth: $(row b_redboth)"
printf '%s' "$(info b_redboth)" | grep -q "WOULD-FILE" && ok "confirmed RED → WOULD-FILE (dry-run)" || no "redboth fileinfo: $(info b_redboth)"
[ "$(cls c_ambig)" = "YELLOW" ] && printf '%s' "$(info c_ambig)" | grep -qi "ambiguous\|did not reproduce" && ok "verifier disagrees → downgraded YELLOW, not filed" || no "ambig: $(row c_ambig)"
[ "$(cls d_solo)" = "YELLOW" ] && printf '%s' "$(info d_solo)" | grep -q "finder==verifier" && ok "finder==verifier → refused (never one persona alone)" || no "solo: $(row d_solo)"
[ "$(cls e_infra)" = "INFRA" ] && ok "INFRA never filed" || no "infra: $(cls e_infra)"
printf '%s' "$(info g_dup)" | grep -q "DUPLICATE of #999" && ok "dedupe match → DUPLICATE, not re-filed" || no "dup: $(info g_dup)"

# report assertions (Mike-facing)
grep -q "## Overall: RED" "$REPORT" && ok "report overall = RED (a RED present)" || no "report overall"
grep -q "Top blockers" "$REPORT" && grep -q "Suggested next prompt" "$REPORT" && ok "report has blockers + next-prompt sections" || no "report sections"
head -5 "$REPORT" | grep -q "product paths" && ok "report leads with a one-line verdict summary" || no "report summary line"

echo "──────────────"
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
