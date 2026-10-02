#!/usr/bin/env bash
# CODEX_BIN shim for scripts/adversarial-review.sh (CODEX_BIN is an override the
# trusted script already supports). It runs the REAL codex unchanged except for
# two inserted flags, so the trusted review lane itself is never edited:
#   --json                              -> token usage per turn (turn.completed.usage)
#   -c model_reasoning_effort=<effort>  -> only when REVIEW_EFFORT is set
#
# Snapshot binding (Codex #4202 F1): the trusted wrapper exports the base/head
# it captured (ADV_REVIEW_TRUSTED_BASE_SHA / ADV_REVIEW_CANDIDATE_SHA). When the
# router set REVIEW_EXPECTED_BASE/HEAD, a mismatch means the PR moved after it
# was routed and CI-checked, so this refuses before any paid request.
#
# Termination (Codex #4202 F2): codex is exec'd, so it IS the process the
# watchdog kills; the usage copy is a process substitution that ends when
# codex's stdout closes. No paid descendant can outlive a kill of this PID.
set -euo pipefail

REAL_CODEX="${REVIEW_REAL_CODEX:-$(command -v codex)}"
: "${REVIEW_USAGE_FILE:?REVIEW_USAGE_FILE must name the usage capture file}"

if [ "${1:-}" != "exec" ]; then
  exec "$REAL_CODEX" "$@"   # not a review run: pass through untouched
fi
shift

for pair in "REVIEW_EXPECTED_HEAD:ADV_REVIEW_CANDIDATE_SHA" "REVIEW_EXPECTED_BASE:ADV_REVIEW_TRUSTED_BASE_SHA"; do
  want_var="${pair%%:*}"; got_var="${pair##*:}"
  want="${!want_var:-}"; got="${!got_var:-}"
  if [ -n "$want" ] && [ "$want" != "$got" ]; then
    echo "codex_shim: $got_var '$got' != routed $want_var '$want'; refusing (PR moved after routing)" >&2
    exit 65
  fi
done

extra=(--json)
if [ -n "${REVIEW_EFFORT:-}" ]; then
  case "$REVIEW_EFFORT" in
    minimal|low|medium|high|xhigh) extra+=(-c "model_reasoning_effort=$REVIEW_EFFORT") ;;
    *) echo "codex_shim: invalid REVIEW_EFFORT '$REVIEW_EFFORT'" >&2; exit 64 ;;
  esac
fi

echo "launched" > "$REVIEW_USAGE_FILE.started"
exec "$REAL_CODEX" exec "${extra[@]}" "$@" > >(tee -a "$REVIEW_USAGE_FILE")
