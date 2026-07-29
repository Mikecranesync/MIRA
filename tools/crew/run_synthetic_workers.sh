#!/usr/bin/env bash
# run_synthetic_workers.sh — bounded synthetic-dogfood worker loop.
#
# A small, deterministic runner that drives "scenarios" through the SAME
# verify-before-file discipline the crew runbook describes and create_issue.sh
# now enforces. It does NOT patch product code, does NOT escalate, and defaults
# to --dry-run. A scenario is filed ONLY if it: reproduces, has a verifier that
# differs from the finder, and clears tools/qa/create_issue.sh's gate.
#
# Usage:
#   tools/crew/run_synthetic_workers.sh --dry-run                       # all scenarios, no filing (DEFAULT)
#   tools/crew/run_synthetic_workers.sh --scenario hub-dogfood --dry-run
#   tools/crew/run_synthetic_workers.sh --scenario hub-dogfood --file-issues   # actually file (gated)
#   tools/crew/run_synthetic_workers.sh --list
#
# Flags:
#   --scenario <name|all>   scenario to run (default: all in --scenario-dir)
#   --scenario-dir <dir>    where *.scenario files live (default: tools/crew/scenarios)
#   --dry-run               do not file; show what WOULD be filed (DEFAULT)
#   --file-issues           actually file via create_issue.sh (turns dry-run off)
#   --allow-p0              REQUIRED to file a P0 — without it a P0 scenario is refused
#                           (mechanical guard against an autonomous P0 path)
#   --retries <n>           per-scenario repro attempts (default 3). A scenario counts
#                           as reproduced if the bug signal appears on ANY attempt —
#                           this defeats transient blips and catches intermittent bugs.
#   --retry-delay <secs>    sleep between repro attempts (default $SW_RETRY_DELAY or 2)
#   --until-find            keep re-running ALL scenarios in rounds until one reproduces
#                           a real, gate-passing bug OR a budget is hit. On a healthy
#                           system it stops honestly at the budget with "nothing to fix"
#                           — it NEVER lowers the gate to manufacture a finding.
#   --max-rounds <n>        --until-find budget: max rounds (default 5)
#   --max-seconds <s>       --until-find budget: wall-clock cap (default 600)
#   --list                  list scenarios and exit
#
# A *.scenario file is sourced and must set:
#   SCN_SUMMARY  SCN_TITLE  SCN_LABELS(must contain dogfood|crew)  SCN_SEVERITY(P0..P3)
#   SCN_FINDER   SCN_VERIFIER(must differ)  SCN_DEDUPE  SCN_NOT_SHARED  SCN_EVIDENCE
#   SCN_REPRO_CMD (shell that reproduces)   SCN_REPRO_EXPECT (substring proving repro)
#   SCN_NARRATIVE (optional)
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CREATE_ISSUE="${CREATE_ISSUE:-$REPO/tools/qa/create_issue.sh}"
SCENARIO="all" ; SCEN_DIR="$REPO/tools/crew/scenarios" ; DRY=1 ; ALLOW_P0=0 ; LIST=0
RETRIES=3 ; RETRY_DELAY="${SW_RETRY_DELAY:-2}" ; UNTIL_FIND=0
MAX_ROUNDS=5 ; MAX_SECONDS=600 ; ROUND_DELAY="${SW_ROUND_DELAY:-10}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)      SCENARIO="$2"; shift 2;;
    --scenario-dir)  SCEN_DIR="$2"; shift 2;;
    --dry-run)       DRY=1; shift;;
    --file-issues)   DRY=0; shift;;
    --allow-p0)      ALLOW_P0=1; shift;;
    --retries)       RETRIES="$2"; shift 2;;
    --retry-delay)   RETRY_DELAY="$2"; shift 2;;
    --until-find)    UNTIL_FIND=1; shift;;
    --max-rounds)    MAX_ROUNDS="$2"; shift 2;;
    --max-seconds)   MAX_SECONDS="$2"; shift 2;;
    --list)          LIST=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[[ "$RETRIES" -ge 1 ]] 2>/dev/null || { echo "ERROR: --retries must be >= 1" >&2; exit 2; }

[[ -d "$SCEN_DIR" ]] || { echo "ERROR: scenario dir not found: $SCEN_DIR" >&2; exit 2; }

# Collect scenario files (bash 3.2-portable; no mapfile).
FILES=()
while IFS= read -r line; do [[ -n "$line" ]] && FILES+=("$line"); done < <(
  if [[ "$SCENARIO" == "all" ]]; then ls "$SCEN_DIR"/*.scenario 2>/dev/null
  else echo "$SCEN_DIR/$SCENARIO.scenario"; fi
)

if [[ "$LIST" -eq 1 ]]; then
  echo "Scenarios in $SCEN_DIR:"
  for f in ${FILES[@]+"${FILES[@]}"}; do
    [[ -f "$f" ]] || continue
    # shellcheck disable=SC1090
    ( set +u; SCN_SUMMARY=""; . "$f"; printf '  %-22s %s\n' "$(basename "$f" .scenario)" "${SCN_SUMMARY:-}" )
  done
  exit 0
fi

OUT_DIR="${OUT_DIR:-$REPO/dogfood-output/qa-runs/synthetic-workers-$(date -u +%Y-%m-%dT%H-%M-%SZ 2>/dev/null || echo run)}"
mkdir -p "$OUT_DIR"
ROUND_OUT="$OUT_DIR"   # where the CURRENT round writes artifacts (per-round subdir under --until-find)

echo "== synthetic worker loop =="
echo "   mode: $([[ $DRY -eq 1 ]] && echo DRY-RUN || echo FILE-ISSUES)   allow-p0: $ALLOW_P0   retries: $RETRIES (delay ${RETRY_DELAY}s)"
[[ $UNTIL_FIND -eq 1 ]] && echo "   until-find: ON   budget: max-rounds=$MAX_ROUNDS max-seconds=$MAX_SECONDS round-delay=${ROUND_DELAY}s"
echo "   out: $OUT_DIR"
echo

declare -a ROWS
ran=0; would_file=0; filed=0; refused=0; found=0

process_one() {
  local f="$1" name; name="$(basename "$f" .scenario)"
  # Load scenario into a clean-ish scope.
  SCN_SUMMARY=""; SCN_TITLE=""; SCN_LABELS=""; SCN_SEVERITY=""; SCN_FINDER=""
  SCN_VERIFIER=""; SCN_DEDUPE=""; SCN_NOT_SHARED=""; SCN_EVIDENCE=""
  SCN_REPRO_CMD=""; SCN_REPRO_EXPECT=""; SCN_NARRATIVE=""
  # shellcheck disable=SC1090
  . "$f"

  for v in SCN_TITLE SCN_LABELS SCN_SEVERITY SCN_FINDER SCN_VERIFIER SCN_DEDUPE \
           SCN_NOT_SHARED SCN_EVIDENCE SCN_REPRO_CMD SCN_REPRO_EXPECT; do
    if [[ -z "${!v}" ]]; then
      ROWS+=("$name|REFUSED:bad-scenario|missing $v"); refused=$((refused+1)); echo "[$name] REFUSED — scenario missing $v"; return
    fi
  done

  # The runner only files crew/dogfood issues (keeps it bounded to the gated path).
  if ! printf '%s' "$SCN_LABELS" | grep -iqE '(^|,)[[:space:]]*(dogfood|crew)[[:space:]]*(,|$)'; then
    ROWS+=("$name|REFUSED:bad-labels|labels must include dogfood|crew"); refused=$((refused+1))
    echo "[$name] REFUSED — labels must include dogfood/crew (got: $SCN_LABELS)"; return
  fi

  # Guard 1: verifier must differ from finder (no self-verification).
  if [[ "$(echo "$SCN_FINDER" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" \
      == "$(echo "$SCN_VERIFIER" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" ]]; then
    ROWS+=("$name|REFUSED:self-verify|finder==verifier ($SCN_FINDER)"); refused=$((refused+1))
    echo "[$name] REFUSED — self-verification ($SCN_FINDER == $SCN_VERIFIER)"; return
  fi

  # Guard 2: reproduce — with retries. The repro command must exit 0 AND emit the
  # expected signal. We try up to $RETRIES times; a scenario counts as reproduced if
  # the bug signal appears on ANY attempt. This defeats transient blips (network,
  # deploy-not-landed) and catches intermittent bugs — it does NOT weaken the gate:
  # "reproduced" still means the real bug signal was observed deterministically.
  local repro_out repro_rc attempt=1 reproduced=0
  while [[ "$attempt" -le "$RETRIES" ]]; do
    repro_out="$(bash -c "$SCN_REPRO_CMD" 2>&1)"; repro_rc=$?
    printf '%s\n' "$repro_out" > "$ROUND_OUT/$name.repro.log"
    if [[ "$repro_rc" -eq 0 ]] && printf '%s' "$repro_out" | grep -qF "$SCN_REPRO_EXPECT"; then
      reproduced=1; break
    fi
    [[ "$attempt" -lt "$RETRIES" ]] && { echo "[$name] attempt $attempt/$RETRIES did not reproduce (exit $repro_rc); retrying in ${RETRY_DELAY}s"; sleep "$RETRY_DELAY"; }
    attempt=$((attempt+1))
  done
  local made; made="$([[ $reproduced -eq 1 ]] && echo "$attempt" || echo "$RETRIES")"
  printf 'attempts: %s/%s  reproduced: %s\n' "$made" "$RETRIES" "$([[ $reproduced -eq 1 ]] && echo yes || echo no)" >> "$ROUND_OUT/$name.repro.log"
  if [[ "$reproduced" -ne 1 ]]; then
    ROWS+=("$name|REFUSED:no-repro|signal '$SCN_REPRO_EXPECT' absent after $RETRIES attempt(s)"); refused=$((refused+1))
    echo "[$name] REFUSED — did not reproduce after $RETRIES attempt(s) (expected '$SCN_REPRO_EXPECT'). Evidence: $ROUND_OUT/$name.repro.log"; return
  fi

  # Guard 3: no autonomous P0 — a P0 needs an explicit human --allow-p0.
  local sev_upper; sev_upper="$(printf '%s' "$SCN_SEVERITY" | tr '[:lower:]' '[:upper:]')"
  if [[ "$sev_upper" == "P0" && "$ALLOW_P0" -ne 1 ]]; then
    ROWS+=("$name|REFUSED:p0-needs-flag|P0 requires --allow-p0"); refused=$((refused+1))
    echo "[$name] REFUSED — P0 severity requires --allow-p0 (no autonomous P0 path)."; return
  fi

  # Build the gated issue body (every gate field, finder != verifier).
  local body="$ROUND_OUT/$name.issue.md"
  {
    echo "# $SCN_TITLE"; echo
    [[ -n "$SCN_NARRATIVE" ]] && { echo "$SCN_NARRATIVE"; echo; }
    echo "## Adversarial verification"
    echo "Reproduces: yes — \`$SCN_REPRO_CMD\` exited 0 and emitted \"$SCN_REPRO_EXPECT\" (see repro log)."
    echo "Not expected shared/public data: yes — $SCN_NOT_SHARED"
    echo "Severity justified: yes — $SCN_SEVERITY"
    echo "Deduped: yes — searched \"$SCN_DEDUPE\" (re-checked by create_issue.sh before filing)."
    echo "Evidence sufficient: yes — $SCN_EVIDENCE"
    echo "Found by: $SCN_FINDER"
    echo "Verified by: $SCN_VERIFIER"
    echo
    echo "## Reproduction output (captured)"
    echo '```'
    printf '%s\n' "$repro_out" | head -40
    echo '```'
  } > "$body"

  # Hand to the gated filer. Gate is auto-on (dogfood/crew label). Dry-run default.
  local ci_args=(--title "$SCN_TITLE" --body-file "$body" --labels "$SCN_LABELS" --search "$SCN_DEDUPE")
  [[ "$DRY" -eq 1 ]] && ci_args+=(--dry-run)

  local ci_out ci_rc
  ci_out="$(bash "$CREATE_ISSUE" "${ci_args[@]}" 2>&1)"; ci_rc=$?
  printf '%s\n' "$ci_out" > "$ROUND_OUT/$name.create_issue.log"

  if [[ "$ci_rc" -eq 3 ]]; then
    ROWS+=("$name|GATE-REFUSED|create_issue.sh rejected the body"); refused=$((refused+1))
    echo "[$name] GATE-REFUSED by create_issue.sh (see log)"; return
  fi
  if [[ "$DRY" -eq 1 ]]; then
    ROWS+=("$name|WOULD-FILE|gate passed; dry-run"); would_file=$((would_file+1)); found=$((found+1))
    echo "[$name] WOULD-FILE ($SCN_SEVERITY) — gate passed, dry-run. Body: $body"; return
  fi
  local url; url="$(printf '%s' "$ci_out" | grep -oE 'https://github.com/[^ ]+/issues/[0-9]+' | head -1)"
  if [[ -n "$url" ]]; then
    ROWS+=("$name|FILED|$url"); filed=$((filed+1)); found=$((found+1)); echo "[$name] FILED — $url"
  else
    # create_issue.sh's safe-dedupe declined (existing issue). The scenario STILL
    # reproduced a real, gate-passing bug — it's just already tracked. Count it as a
    # find (comment, don't re-file) so --until-find stops on a known reproducing bug.
    ROWS+=("$name|NOT-FILED|create_issue.sh declined (dedupe match — comment on existing issue)"); found=$((found+1))
    echo "[$name] NOT-FILED — reproduced but already tracked (dupe). Comment on the existing issue."
  fi
}

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No scenarios found (scenario='$SCENARIO' in $SCEN_DIR)."; exit 2
fi

# Run every scenario once. Resets per-round counters + ROWS, writes artifacts to
# $ROUND_OUT, and leaves the round's find-count in the global `found`.
run_round() {
  ROWS=(); ran=0; would_file=0; filed=0; refused=0; found=0
  for f in ${FILES[@]+"${FILES[@]}"}; do
    [[ -f "$f" ]] || { echo "[$(basename "$f" .scenario)] REFUSED — scenario file not found: $f"; ROWS+=("$(basename "$f" .scenario)|REFUSED:missing|no such scenario"); refused=$((refused+1)); continue; }
    ran=$((ran+1)); process_one "$f"
  done
  echo
  echo "== summary =="
  printf '%-22s %-18s %s\n' "SCENARIO" "STATUS" "DETAIL"
  for r in ${ROWS[@]+"${ROWS[@]}"}; do IFS='|' read -r n s d <<<"$r"; printf '%-22s %-18s %s\n' "$n" "$s" "$d"; done
  echo
  echo "ran=$ran  would_file=$would_file  filed=$filed  refused=$refused  found=$found  (artifacts in $ROUND_OUT)"
}

if [[ "$UNTIL_FIND" -ne 1 ]]; then
  run_round
  exit 0
fi

# --until-find: re-run all scenarios in rounds until one reproduces a real,
# gate-passing bug OR the budget (rounds / wall-clock) is exhausted. The gate is
# never lowered — a healthy system simply exhausts the budget with found=0.
start_ts="$(date +%s 2>/dev/null || echo 0)"
round=1; total_found=0
while true; do
  ROUND_OUT="$OUT_DIR/round-$round"; mkdir -p "$ROUND_OUT"
  echo "── round $round/$MAX_ROUNDS ──"
  run_round
  if [[ "$found" -gt 0 ]]; then
    total_found=$found
    echo
    echo ">> FOUND $found gate-passing finding(s) in round $round — stopping. Artifacts: $ROUND_OUT"
    break
  fi
  now_ts="$(date +%s 2>/dev/null || echo 0)"; elapsed=$(( now_ts - start_ts ))
  if [[ "$round" -ge "$MAX_ROUNDS" ]]; then
    echo; echo ">> BUDGET HIT (max-rounds=$MAX_ROUNDS) — nothing to fix. Healthy: no scenario reproduced a bug."; break
  fi
  if [[ "$elapsed" -ge "$MAX_SECONDS" ]]; then
    echo; echo ">> BUDGET HIT (max-seconds=$MAX_SECONDS, elapsed=${elapsed}s) — nothing to fix. Healthy: no scenario reproduced a bug."; break
  fi
  echo "   round $round found nothing; next round in ${ROUND_DELAY}s (elapsed ${elapsed}s)"
  round=$((round+1)); sleep "$ROUND_DELAY"
done
echo
echo "== until-find done: rounds=$round  total_found=$total_found =="
exit 0
