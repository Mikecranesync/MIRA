#!/usr/bin/env bash
# Drive Commander self-eval scout — Bravo launchd runner (daily).
#
# WHAT: fetch a real, previously-unseen OEM VFD manual off the internet, run it
# through the production drive-pack extractor + scientific grading harness, and
# EMAIL a complete evaluation. The Drive Commander analogue of the PrintSense /
# PLC-laptop autonomous testing loop. See self_eval_scout.py for doctrine.
#
# WHY launchd on Bravo (same rationale as tools/crew/dogfood/scheduled_run.sh):
# Bravo already has Python 3.12 + pdfplumber + Doppler; the run needs outbound
# internet (fetch a manual) and RESEND (send the email), both of which a
# GitHub-hosted runner could do — but keeping the whole autonomous-eval fleet on
# one host (dogfood judge, RBAC weekly, this) is simpler to operate and audit.
#
# EMAIL: sent via RESEND (RESEND_API_KEY from Doppler factorylm/prd, the same key
# morning_report.py uses). launchd's non-login env can't read the keychain Doppler
# token, so this reads a prd-scoped service token from a 0600 file (see below),
# exactly like the dogfood job reads its stg token.
#
# Manual run (keychain token works in an interactive shell):
#   doppler run --project factorylm --config prd -- \
#     python3.12 tools/drive-pack-extract/self_eval_scout.py --send
# Scheduled: ~/Library/LaunchAgents/com.factorylm.drive-commander-scout.plist (daily)
set -uo pipefail

REPO="/Users/bravonode/Mira"
# launchd starts with a minimal PATH — pin the toolchain explicitly.
export PATH="/Users/bravonode/.local/bin:/Users/bravonode/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# prd-scoped read-only Doppler service token (for RESEND_API_KEY). launchd's
# non-login env can't read the keychain CLI token; store one 0600, uncommitted.
DOPPLER_TOKEN_FILE="${DOPPLER_TOKEN_FILE:-$HOME/.doppler/drive-commander-scout-prd.token}"
if [ -z "${DOPPLER_TOKEN:-}" ] && [ -r "$DOPPLER_TOKEN_FILE" ]; then
  DOPPLER_TOKEN="$(cat "$DOPPLER_TOKEN_FILE")"; export DOPPLER_TOKEN
fi

cd "$REPO" || { echo "[scout] repo not found: $REPO"; exit 1; }

OUT="$REPO/dogfood-output/drive-commander-scout"
mkdir -p "$OUT"

# Rotate the target family across runs so each day exercises a different unseen
# manual. Persist a monotonically-incrementing index in a small state file.
STATE="$OUT/.run-index"
IDX=0
[ -r "$STATE" ] && IDX="$(cat "$STATE" 2>/dev/null || echo 0)"
echo "$(( IDX + 1 ))" > "$STATE"

echo "[scout] start $(date -u +%Y-%m-%dT%H:%M:%SZ)  HEAD=$(git rev-parse --short HEAD 2>/dev/null)  run-index=$IDX"

# --send emails the evaluation via RESEND; the artifact is always written to $OUT.
doppler run --project factorylm --config prd -- \
  python3.12 tools/drive-pack-extract/self_eval_scout.py \
    --send --run-index "$IDX" --out "$OUT"
rc=$?

echo "[scout] done rc=$rc — latest: $OUT/latest-eval.md"
# One-line trend entry so a human can skim history without opening each report.
subj="$(head -1 "$OUT/latest-eval.md" 2>/dev/null | sed 's/^# //')"
printf '%s  rc=%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "${subj:-<no report>}" >> "$OUT/history.log"
exit "$rc"
