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
#     [--dry-run]
#
# Notes:
#   - Repo is fixed to Mikecranesync/MIRA.
#   - Prints the issue URL on success.
#   - --dry-run shows the dedupe matches and the command without creating.
set -euo pipefail

REPO="Mikecranesync/MIRA"
TITLE="" ; BODY_FILE="" ; LABELS="" ; SEARCH="" ; DRY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)      TITLE="$2"; shift 2;;
    --body-file)  BODY_FILE="$2"; shift 2;;
    --labels)     LABELS="$2"; shift 2;;
    --search)     SEARCH="$2"; shift 2;;
    --dry-run)    DRY=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[[ -z "$TITLE" ]] && { echo "ERROR: --title is required" >&2; exit 2; }
[[ -n "$BODY_FILE" && ! -f "$BODY_FILE" ]] && { echo "ERROR: --body-file not found: $BODY_FILE" >&2; exit 2; }
[[ -z "$SEARCH" ]] && SEARCH="$TITLE"

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
