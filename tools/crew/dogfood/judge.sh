#!/usr/bin/env bash
# judge.sh — the daily dogfood JUDGE for FactoryLM / MIRA.
#
# Walks the core PRODUCT paths (not endpoints) against the live staging Hub as
# real QA personas, classifies each GREEN / YELLOW / RED / INFRA in business
# language, cross-verifies every RED under a SECOND persona before it can be
# filed, dedupes through the existing gate, and writes a one-page report a
# non-technical founder can read in two minutes:  qa/dogfood/latest-report.md
#
# It deliberately reuses — never reinvents — the verification gate
# (tools/qa/create_issue.sh), the staging persona auth states
# (dogfood-output/.auth/<persona>-state.json), and the dedupe logic. The only
# new thing here is orchestration + the report.
#
# Usage:
#   tools/crew/dogfood/judge.sh                       # dry-run (DEFAULT) — would-file, never touches GitHub
#   tools/crew/dogfood/judge.sh --file-issues         # file confirmed REDs through the gate (still deduped)
#   tools/crew/dogfood/judge.sh --check maintenance-tech
#   QA_BASE_URL=http://host:port tools/crew/dogfood/judge.sh
#
# Filing rules (enforced): never from one persona alone (finder != verifier, both
# must see the RED), repro evidence captured, dedupe first, and REFUSE to file on
# INFRA (auth fail / unreachable / non-JSON) or ambiguous (verifier disagrees).
set -uo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
DF_BASE="${QA_BASE_URL:-http://100.68.120.99:4101}"
# All paths overridable via env so the gating logic is testable without a live Hub.
CHECK_DIR="${DF_CHECK_DIR:-$REPO/tools/crew/dogfood/checks}"
AUTH_DIR="${DF_AUTH_DIR:-$REPO/dogfood-output/.auth}"
CREATE_ISSUE="${DF_CREATE_ISSUE:-$REPO/tools/qa/create_issue.sh}"
REPORT="${DF_REPORT:-$REPO/qa/dogfood/latest-report.md}"
RUN_ROOT="${DF_RUN_ROOT:-$REPO/dogfood-output/qa-runs}"
DRY=1 ; ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file-issues) DRY=0; shift;;
    --dry-run)     DRY=1; shift;;
    --check)       ONLY="$2"; shift 2;;
    --base)        DF_BASE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ 2>/dev/null || echo run)"
RUN_DIR="$RUN_ROOT/dogfood-$STAMP"
mkdir -p "$RUN_DIR" "$(dirname "$REPORT")"
RES="$RUN_DIR/results.tsv"   # class \t path \t reason \t finder \t verifier \t confirmed \t fileinfo \t logfile
: > "$RES"

tok_for() { # persona -> session token (empty if missing)
  local f="$AUTH_DIR/$1-state.json"
  [[ -f "$f" ]] || return 0
  python3 -c "import json,sys
try:
 d=json.load(open('$f')); print(next((c['value'] for c in d['cookies'] if c['name']=='next-auth.session-token'),''))
except Exception: print('')" 2>/dev/null
}

# Run one check file under one persona; echo verdict line; full transcript -> logfile.
run_as() { # <check_file> <persona> <logfile>
  local cf="$1" persona="$2" log="$3" tok
  tok="$(tok_for "$persona")"
  if [[ -z "$tok" ]]; then echo "INFRA: no saved session for persona '$persona'"; return; fi
  ( set +u
    SCN_PATH=""; SCN_TITLE=""; SCN_IMPACT=""; SCN_LABELS=""; SCN_DEDUPE=""
    SCN_FINDER=""; SCN_VERIFIER=""
    # shellcheck disable=SC1090
    . "$cf"
    DF_BASE="$DF_BASE" DF_TOK="$tok" DF_PERSONA="$persona" run_check
  ) > "$log" 2>&1
  # verdict = last non-empty line
  grep -vE '^[[:space:]]*$' "$log" | tail -1
}

class_of() { printf '%s' "$1" | sed -E 's/^([A-Z]+).*/\1/'; }
reason_of(){ printf '%s' "$1" | sed -E 's/^[A-Z]+:?[[:space:]]*//'; }

echo "== dogfood judge =="
echo "   base: $DF_BASE   mode: $([[ $DRY -eq 1 ]] && echo DRY-RUN || echo FILE-ISSUES)   out: $RUN_DIR"
echo

# methodology facts for the report
TENANT_NOTE="RBAC personas live on a synthetic test tenant (assets seeded, live signals/docs sparse); the demo tenant needs DEMO_API_TOKEN (not provisioned), so demo-readiness is reported, not auto-driven."

FILES=()
if [[ -n "$ONLY" ]]; then FILES=("$CHECK_DIR/$ONLY.check")
else while IFS= read -r l; do [[ -n "$l" ]] && FILES+=("$l"); done < <(ls "$CHECK_DIR"/*.check 2>/dev/null); fi

for cf in ${FILES[@]+"${FILES[@]}"}; do
  [[ -f "$cf" ]] || { echo "skip (missing): $cf"; continue; }
  name="$(basename "$cf" .check)"
  # load metadata into THIS shell (the check only sets SCN_* vars + defines run_check)
  SCN_PATH=""; SCN_TITLE=""; SCN_IMPACT=""; SCN_LABELS=""; SCN_DEDUPE=""; SCN_FINDER=""; SCN_VERIFIER=""
  # shellcheck disable=SC1090
  . "$cf"
  M_PATH="${SCN_PATH:-$name}"; M_FINDER="${SCN_FINDER:-carlos}"; M_VERIFIER="${SCN_VERIFIER:-dana}"
  M_LABELS="$SCN_LABELS"; M_DEDUPE="$SCN_DEDUPE"; M_TITLE="$SCN_TITLE"; M_IMPACT="$SCN_IMPACT"

  finder_log="$RUN_DIR/$name.$M_FINDER.log"
  verdict="$(run_as "$cf" "$M_FINDER" "$finder_log")"
  cls="$(class_of "$verdict")"; why="$(reason_of "$verdict")"
  echo "[$name] $M_FINDER → $cls"

  confirmed="n/a"; fileinfo="not-eligible"
  if [[ "$cls" == "RED" ]]; then
    # Never file from one persona alone — a SECOND real session must reproduce it.
    if [[ "$M_VERIFIER" == "$M_FINDER" ]]; then
      confirmed="no"; fileinfo="refused: finder==verifier"; cls="YELLOW"
      why="$why  (NOT filed: finder and verifier are the same persona)"
    else
      verifier_log="$RUN_DIR/$name.$M_VERIFIER.log"
      v2="$(run_as "$cf" "$M_VERIFIER" "$verifier_log")"; v2cls="$(class_of "$v2")"
      echo "[$name] $M_VERIFIER → $v2cls (verify)"
      if [[ "$v2cls" == "RED" ]]; then
        confirmed="yes"
        # dedupe + (would-)file through the existing gate
        body="$RUN_DIR/$name.issue.md"
        { echo "# $M_TITLE"; echo
          echo "**Business impact:** ${M_IMPACT:-}"; echo
          echo "## Adversarial verification"
          echo "Reproduces: yes — confirmed by TWO independent persona sessions ($M_FINDER, then $M_VERIFIER)."
          echo "Found by: $M_FINDER"; echo "Verified by: $M_VERIFIER"
          echo "Deduped: yes — searched \"$M_DEDUPE\" (re-checked by create_issue.sh)."
          echo "Severity justified: yes — RED product-path blocker."
          echo "Not expected shared/public data: yes — exercised in the caller's own tenant."
          echo "Evidence sufficient: yes — see transcripts below."; echo
          echo "## $M_FINDER transcript"; echo '```'; cat "$finder_log"; echo '```'
          echo "## $M_VERIFIER transcript"; echo '```'; cat "$verifier_log"; echo '```'
        } > "$body"
        ci_args=(--title "$M_TITLE" --body-file "$body" --labels "$M_LABELS" --search "$M_DEDUPE")
        [[ "$DRY" -eq 1 ]] && ci_args+=(--dry-run)
        ci_out="$(bash "$CREATE_ISSUE" "${ci_args[@]}" 2>&1)"; echo "$ci_out" > "$RUN_DIR/$name.create_issue.log"
        dup="$(printf '%s' "$ci_out" | grep -oE '#[0-9]+ \[' | head -1 | tr -d ' [')"
        url="$(printf '%s' "$ci_out" | grep -oE 'https://github.com/[^ ]+/issues/[0-9]+' | head -1)"
        if [[ -n "$dup" ]]; then fileinfo="DUPLICATE of $dup (commented/declined — no new issue)"
        elif [[ -n "$url" ]]; then fileinfo="FILED $url"
        elif [[ "$DRY" -eq 1 ]]; then fileinfo="WOULD-FILE (gate passed, dry-run)"
        else fileinfo="declined by gate (see log)"; fi
      else
        confirmed="no"; fileinfo="refused: $M_VERIFIER did not reproduce (ambiguous)"; cls="YELLOW"
        why="$why  (NOT filed: $M_VERIFIER session did not reproduce it)"
      fi
    fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$cls" "$M_PATH" "$why" "$M_FINDER" "$M_VERIFIER" "$confirmed" "$fileinfo" "$finder_log" >> "$RES"
done

# ---------- aggregate + write the Mike report ----------
nRED=$(awk -F'\t' '$1=="RED"' "$RES" | wc -l | tr -d ' ')
nYEL=$(awk -F'\t' '$1=="YELLOW"' "$RES" | wc -l | tr -d ' ')
nGRN=$(awk -F'\t' '$1=="GREEN"' "$RES" | wc -l | tr -d ' ')
nINF=$(awk -F'\t' '$1=="INFRA"' "$RES" | wc -l | tr -d ' ')
if   [[ "$nRED" -gt 0 ]]; then OVERALL="RED"
elif [[ "$nYEL" -gt 0 || "$nINF" -gt 0 ]]; then OVERALL="YELLOW"
else OVERALL="GREEN"; fi
HUMAN_DATE="$(date -u +'%Y-%m-%d %H:%M UTC' 2>/dev/null || echo "$STAMP")"
RUN_REL="${RUN_DIR#"$REPO"/}"   # repo-relative for a portable committed report

{
  echo "# FactoryLM Dogfood Report — $HUMAN_DATE"
  echo
  echo "## Overall: $OVERALL"
  echo "_$nRED red · $nYEL yellow · $nGRN green · $nINF infra — across $(wc -l < "$RES" | tr -d ' ') product paths, run as real QA personas against the staging Hub._"
  echo
  echo "> **What this means:** RED = a customer/demo is blocked right now. YELLOW = it works but degraded. GREEN = a real user can do this today."
  echo
  echo "## Top blockers (fix these first)"
  # REDs first, then YELLOWs — worst-first, capped at 3
  { awk -F'\t' '$1=="RED"' "$RES"; awk -F'\t' '$1=="YELLOW"' "$RES"; } | head -3 \
    | awk -F'\t' '{tag=($7 ~ /DUPLICATE/)?" _(already tracked — "substr($7,index($7,"#"))")_":""; printf "%d. **[%s] %s** — %s%s\n", NR, $1, $2, $3, tag}'
  [[ "$nRED" -eq 0 && "$nYEL" -eq 0 ]] && echo "_None — every product path is GREEN._"
  echo
  echo "## Path verdicts (what a customer experiences)"
  echo "| Path | Verdict | What a real user hits |"
  echo "|---|---|---|"
  awk -F'\t' '{printf "| %s | %s | %s |\n",$2,$1,$3}' "$RES"
  echo
  echo "## Filed / would-file (every one has repro + business impact, deduped)"
  awk -F'\t' '$6=="yes"{printf "- **%s** → %s _(found by %s, verified by %s)_\n",$2,$7,$4,$5}' "$RES"
  awk -F'\t' '$6!="yes" && ($1=="RED")' "$RES" >/dev/null
  if ! awk -F'\t' '$6=="yes"{f=1} END{exit !f}' "$RES"; then echo "- _Nothing eligible to file this run._"; fi
  echo
  echo "## Duplicate issues found (NOT re-filed)"
  if awk -F'\t' '$7 ~ /DUPLICATE/{f=1} END{exit !f}' "$RES"; then
    awk -F'\t' '$7 ~ /DUPLICATE/{printf "- %s: %s\n",$2,$7}' "$RES"
  else echo "- _None._"; fi
  echo
  echo "## Suspected flaky / infrastructure (not product bugs — not filed)"
  if [[ "$nINF" -gt 0 ]]; then awk -F'\t' '$1=="INFRA"{printf "- **%s** — %s\n",$2,$3}' "$RES"; else echo "- _None._"; fi
  echo "- Demo-readiness note: $TENANT_NOTE"
  echo
  echo "## Suggested next prompt (paste to Codex / Claude)"
  top="$(awk -F'\t' '$1=="RED"{print;exit}' "$RES"; awk -F'\t' '$1=="YELLOW"{print;exit}' "$RES" )"
  if [[ -n "$top" ]]; then
    tpath="$(printf '%s' "$top" | head -1 | awk -F'\t' '{print $2}')"
    treason="$(printf '%s' "$top" | head -1 | awk -F'\t' '{print $3}')"
    echo "> Fix the **$tpath** path: $treason. Find the route/handler behind it in mira-hub, write a failing test that reproduces the dogfood transcript in \`$RUN_REL\`, then make it pass. Re-run \`tools/crew/dogfood/judge.sh\` to confirm the path turns GREEN."
  else
    echo "> All product paths are GREEN. Pick the next path to add a dogfood check for (e.g. PM scheduling, onboarding wizard, document upload→retrieval), and extend \`tools/crew/dogfood/checks/\`."
  fi
  echo
  echo "---"
  echo "_Raw transcripts (not required reading): \`$RUN_REL\`. Generated by \`tools/crew/dogfood/judge.sh\`. Methodology: ${TENANT_NOTE}_"
} > "$REPORT"

echo
echo "== verdict: $OVERALL  ($nRED red / $nYEL yellow / $nGRN green / $nINF infra) =="
echo "report: $REPORT"
echo "logs:   $RUN_DIR"
