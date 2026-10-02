#!/usr/bin/env bash
# CODEX_BIN shim for scripts/adversarial-review.sh (CODEX_BIN is an override the
# trusted script already supports). It runs the REAL codex unchanged except for
# two inserted flags, so the trusted review lane itself is never edited:
#   --json                              -> token usage per turn (turn.completed.usage)
#   -c model_reasoning_effort=<effort>  -> only when REVIEW_EFFORT is set
# The event stream is copied to REVIEW_USAGE_FILE for cost accounting. The
# trusted script reads its verdict from --output-last-message, never from this
# stdout, so the extra JSON lines change nothing it consumes.
set -euo pipefail

REAL_CODEX="${REVIEW_REAL_CODEX:-$(command -v codex)}"
: "${REVIEW_USAGE_FILE:?REVIEW_USAGE_FILE must name the usage capture file}"

if [ "${1:-}" != "exec" ]; then
  exec "$REAL_CODEX" "$@"   # not a review run: pass through untouched
fi
shift

extra=(--json)
if [ -n "${REVIEW_EFFORT:-}" ]; then
  case "$REVIEW_EFFORT" in
    minimal|low|medium|high|xhigh) extra+=(-c "model_reasoning_effort=$REVIEW_EFFORT") ;;
    *) echo "codex_shim: invalid REVIEW_EFFORT '$REVIEW_EFFORT'" >&2; exit 64 ;;
  esac
fi

"$REAL_CODEX" exec "${extra[@]}" "$@" | tee -a "$REVIEW_USAGE_FILE"
exit "${PIPESTATUS[0]}"
