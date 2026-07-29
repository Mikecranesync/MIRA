#!/usr/bin/env bash
# hermes-staging-review.sh — async qualitative review of the MIRA staging twin.
#
# Two-layer design (Cluster Law 2 — keep the binary check out of the LLM):
#   1. DETERMINISTIC GATE: run tools/staging/staging-smoke.sh (curl + assert).
#      If a required surface is down, there is nothing to review — alert and stop.
#   2. ASYNC JUDGMENT: only if the gate passes, ask Hermes to browse the staging
#      Hub + Web and judge whether the deployed change looks correct, then post
#      the verdict to Telegram. This is advisory — it is NOT a CI gate and must
#      never block a deploy. It is the "Mike + Hermes look before prod" layer.
#
# Runs on CHARLIE (where Hermes lives: ~/.hermes, OpenAI→OpenRouter fallback).
# The VPS cannot reach CHARLIE, so this is triggered FROM CHARLIE — by hand
# after a staging deploy, by a Jarvis-node webhook, or by cron. See
# docs/runbooks/staging-twin-review.md.
#
# Usage:
#   tools/staging/hermes-staging-review.sh ["what was deployed (branch/PR/desc)"]
#
# Env:
#   STAGING_HOST       default 165.245.138.91 (passed through to the smoke gate)
#   HERMES_TG_TARGET   telegram target (default: "telegram" home channel)
#   HERMES_MODEL       optional model override for the review
#   HERMES_PROVIDER    optional inference provider override (e.g. "openrouter").
#                      NOTE: the configured primary (gpt-5.5 via openai-api) has
#                      been quota-dead; the one-shot path does not always engage
#                      the OpenRouter fallback. Drive it explicitly, e.g.:
#                        HERMES_PROVIDER=openrouter \
#                        HERMES_MODEL=nvidia/nemotron-3-super-120b-a12b:free \
#                        tools/staging/hermes-staging-review.sh "..."
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${STAGING_HOST:-165.245.138.91}"
TG_TARGET="${HERMES_TG_TARGET:-telegram}"
WHAT="${1:-current main HEAD}"
HUB_URL="http://$HOST:4101"
WEB_URL="http://$HOST:4200"

send_tg() { hermes send --to "$TG_TARGET" -s "MIRA staging review" "$1" 2>/dev/null || echo "[warn] telegram send failed"; }

# ---- Layer 1: deterministic gate -------------------------------------------
echo "=== Layer 1: deterministic smoke gate ==="
SMOKE_OUT="$(STAGING_HOST="$HOST" bash "$HERE/staging-smoke.sh" 2>&1)"
SMOKE_RC=$?
echo "$SMOKE_OUT"
if [ "$SMOKE_RC" -ne 0 ]; then
  send_tg "🔴 Staging twin FAILED the deterministic smoke gate after deploying: ${WHAT}
Not reviewing — a required surface is down.

$SMOKE_OUT"
  echo "=== smoke gate failed (rc=$SMOKE_RC) — alerted, skipping Hermes review ==="
  exit "$SMOKE_RC"
fi

# ---- Layer 2: async Hermes judgment ----------------------------------------
echo "=== Layer 2: Hermes qualitative review ==="
MODEL_ARG=()
[ -n "${HERMES_MODEL:-}" ] && MODEL_ARG=(-m "$HERMES_MODEL")
[ -n "${HERMES_PROVIDER:-}" ] && MODEL_ARG+=(--provider "$HERMES_PROVIDER")

read -r -d '' PROMPT <<EOF || true
You are reviewing the MIRA STAGING environment (a digital twin of production)
right after a deploy, BEFORE the change ships to prod. What was deployed: ${WHAT}

Browse these staging URLs (plain HTTP, no TLS):
  - Hub (the app under review):  ${HUB_URL}
  - Marketing/web:               ${WEB_URL}

Check for OBVIOUS regressions a human reviewer would catch in 2 minutes:
  - Does the Hub load without a crash / error page / blank screen?
  - Any visible 500s, stack traces, or broken core navigation?
  - Console errors that indicate the build is broken?
  - Does the deployed change "${WHAT}" appear to be present and not obviously broken?

Do NOT deep-test business logic or log in with credentials. This is a smoke-
level visual sanity check, not a full QA pass.

Reply in THIS exact format, terse, for a phone notification:
VERDICT: <LOOKS GOOD | CONCERNS | BROKEN>
- <bullet 1>
- <bullet 2>
- <bullet 3 (optional)>
EOF

REVIEW_OUT="$(hermes chat -q "$PROMPT" -Q -t web,browser,vision ${MODEL_ARG[@]+"${MODEL_ARG[@]}"} 2>&1)"
REVIEW_RC=$?
echo "$REVIEW_OUT"

if [ "$REVIEW_RC" -ne 0 ] || [ -z "$REVIEW_OUT" ]; then
  send_tg "🟡 Staging twin passed the smoke gate after deploying: ${WHAT}
but the Hermes review could not run (rc=$REVIEW_RC). Review manually: ${HUB_URL}"
  echo "=== Hermes review failed (rc=$REVIEW_RC) — smoke gate still PASSED ==="
  exit 0
fi

send_tg "🟢 Staging twin smoke gate PASSED. Hermes review of: ${WHAT}

${REVIEW_OUT}

Review surface: ${HUB_URL}"
echo "=== review complete — verdict sent to ${TG_TARGET} ==="
