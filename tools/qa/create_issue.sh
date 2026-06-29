#!/usr/bin/env bash
# create_issue.sh — file a MIRA GitHub issue with a duplicate check first.
#
# Searches open + closed issues for an obvious match before creating, so QA
# passes don't spam dupes. Body is passed as a FILE (no secrets on argv).
#
# Usage:
#   tools/qa/create_issue.sh \
#     --title "P1(hub): upload returns 500 on folder=brain" \
#     --body-file dogfood-output/qa-runs/<run>/finding.md \
#     --labels "bug,P1,hub,needs-triage" \
#     [--search "upload 500 folder brain"]   # extra dedupe terms (defaults to title)
#     [--require-verification]               # force the adversarial-verification gate
#     [--found-by "<persona>"] [--verified-by "<name>"]  # override body fields
#     [--dry-run]
#
# Notes:
#   - Repo is fixed to Mikecranesync/MIRA.
#   - Prints the issue URL on success.
#   - --dry-run shows the dedupe matches and the command without creating.
#
# ── Adversarial-verification gate (synthetic-worker / crew filing) ────────────
#   A worker may PROPOSE a finding; it may not be FILED until an adversarial
#   verification pass is recorded in the body. The gate is enforced MECHANICALLY
#   here (not just by runbook doctrine — tools/crew/runbook.md).
#
#   The gate is ON when EITHER:
#     - --require-verification is passed, OR
#     - --labels contains "dogfood" or "crew" (crew/dogfood filing is gated by default).
#   Human/manual filing without those labels/flag is UNCHANGED (no gate).
#
#   When ON, the body file MUST contain all five verification fields, each
#   answered "yes", plus a "Found by:" and a DIFFERENT "Verified by:":
#     Reproduces: yes — <how verified>
#     Not expected shared/public data: yes — <reasoning>
#     Severity justified: yes — <final severity>
#     Deduped: yes — <search terms or issue #s checked>
#     Evidence sufficient: yes — <HTTP/log/code evidence reference>
#     Found by: <persona/worker>
#     Verified by: <different name/persona/human>
#   (Field labels are matched case-insensitively and tolerate markdown emphasis.)
set -euo pipefail

REPO="Mikecranesync/MIRA"
TITLE="" ; BODY_FILE="" ; LABELS="" ; SEARCH="" ; DRY=0
REQUIRE_VERIFICATION=0 ; FOUND_BY="" ; VERIFIED_BY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)                 TITLE="$2"; shift 2;;
    --body-file)             BODY_FILE="$2"; shift 2;;
    --labels)                LABELS="$2"; shift 2;;
    --search)                SEARCH="$2"; shift 2;;
    --require-verification)  REQUIRE_VERIFICATION=1; shift;;
    --found-by)              FOUND_BY="$2"; shift 2;;
    --verified-by)           VERIFIED_BY="$2"; shift 2;;
    --dry-run)               DRY=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -z "$TITLE" ]] && { echo "ERROR: --title is required" >&2; exit 2; }
[[ -n "$BODY_FILE" && ! -f "$BODY_FILE" ]] && { echo "ERROR: --body-file not found: $BODY_FILE" >&2; exit 2; }
[[ -z "$SEARCH" ]] && SEARCH="$TITLE"

# ── Decide whether the verification gate applies ─────────────────────────────
# Crew/dogfood filing is gated by default; the flag forces it for anything else.
GATE=0
if [[ "$REQUIRE_VERIFICATION" -eq 1 ]]; then GATE=1; fi
if printf '%s' "$LABELS" | grep -iqE '(^|,)[[:space:]]*(dogfood|crew)[[:space:]]*(,|$)'; then GATE=1; fi

# Extract a field's value from the body (case-insensitive, markdown-tolerant).
_field_val() { # $1 = label
  [[ -f "$BODY_FILE" ]] || return 0
  perl -0777 -e '
    my $l = shift @ARGV; local $/; my $b = <STDIN>; $b =~ s/[*_`>]//g;
    if ($b =~ /\Q$l\E\s*:\s*([^\n]*)/i) { my $x=$1; $x=~s/^\s+//; $x=~s/\s+$//; print $x; }
  ' "$1" < "$BODY_FILE"
}
# True if the field is present AND its value begins with "yes".
_field_yes() { # $1 = label
  local v; v="$(_field_val "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$v" == yes* ]]
}

if [[ "$GATE" -eq 1 ]]; then
  GATE_FAIL=""
  if [[ -z "$BODY_FILE" ]]; then
    GATE_FAIL="no --body-file (the verification fields live in the body)"
  else
    MISSING=()
    _field_yes "Reproduces"                        || MISSING+=("Reproduces: yes")
    _field_yes "Not expected shared/public data"   || MISSING+=("Not expected shared/public data: yes")
    _field_yes "Severity justified"                || MISSING+=("Severity justified: yes")
    _field_yes "Deduped"                           || MISSING+=("Deduped: yes")
    _field_yes "Evidence sufficient"               || MISSING+=("Evidence sufficient: yes")
    [[ ${#MISSING[@]} -gt 0 ]] && GATE_FAIL="missing/!=yes verification field(s): ${MISSING[*]}"

    # Adversarial verifier must exist and DIFFER from the finder.
    FOUND_RESOLVED="${FOUND_BY:-$(_field_val "Found by")}"
    VERIFIER_RESOLVED="${VERIFIED_BY:-$(_field_val "Verified by")}"
    if [[ -z "$GATE_FAIL" ]]; then
      if [[ -z "$VERIFIER_RESOLVED" ]]; then
        GATE_FAIL="no 'Verified by:' — an adversarial verifier must sign off"
      elif [[ -z "$FOUND_RESOLVED" ]]; then
        GATE_FAIL="no 'Found by:' — cannot confirm the verifier differs from the finder"
      else
        f="$(printf '%s' "$FOUND_RESOLVED"    | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
        v="$(printf '%s' "$VERIFIER_RESOLVED" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
        if [[ "$f" == "$v" ]]; then
          GATE_FAIL="'Verified by' ($VERIFIER_RESOLVED) must differ from 'Found by' ($FOUND_RESOLVED) — self-verification is not allowed"
        fi
      fi
    fi
  fi

  if [[ -n "$GATE_FAIL" ]]; then
    echo "Refusing to file dogfood issue: missing adversarial verification gate." >&2
    echo "  reason: $GATE_FAIL" >&2
    echo "  required in the body (each 'yes'): Reproduces / Not expected shared/public data / Severity justified / Deduped / Evidence sufficient" >&2
    echo "  plus: 'Found by: <persona>' and a DIFFERENT 'Verified by: <name>'." >&2
    echo "  See tools/crew/runbook.md § Verify-before-file gate." >&2
    exit 3
  fi
  echo "==> Verification gate PASSED (found by: ${FOUND_RESOLVED} / verified by: ${VERIFIER_RESOLVED})"
fi

echo "==> Dedupe search in $REPO for: $SEARCH"
# Search open AND closed so we don't refile something already fixed/triaged.
MATCHES="$(gh issue list -R "$REPO" --state all --search "$SEARCH" \
            --limit 10 --json number,title,state,url \
            --jq '.[] | "  #\(.number) [\(.state)] \(.title)\n    \(.url)"' 2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
  echo "Possible duplicates found:"
  echo "$MATCHES"
  echo
  echo "If one of these matches, COMMENT on it instead:"
  echo "  gh issue comment -R $REPO <number> --body-file $BODY_FILE"
  if [[ "$DRY" -eq 0 ]]; then
    if [[ -t 0 ]]; then
      read -r -p "No match — create a NEW issue anyway? [y/N] " ans
      [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted (treat an existing issue as the home for this finding)."; exit 0; }
    else
      # Non-interactive (e.g. Hermes): never block on a prompt. Default to SAFE —
      # abort rather than risk a duplicate. Re-run with --force to override.
      if [[ "${FORCE:-0}" -eq 1 ]]; then
        echo "Non-interactive + FORCE=1 — creating despite possible duplicates."
      else
        echo "Non-interactive: possible duplicates exist — NOT creating. Comment on one above, or re-run with FORCE=1 to override."
        exit 0
      fi
    fi
  fi
else
  echo "  (no matches)"
fi

CMD=(gh issue create -R "$REPO" --title "$TITLE")
[[ -n "$BODY_FILE" ]] && CMD+=(--body-file "$BODY_FILE")
[[ -n "$LABELS"    ]] && CMD+=(--label "$LABELS")

if [[ "$DRY" -eq 1 ]]; then
  echo "DRY-RUN, would run:"; printf '  %q ' "${CMD[@]}"; echo
  exit 0
fi

URL="$("${CMD[@]}")"
echo "Created: $URL"
