#!/usr/bin/env bash
# Dogfood judge — Bravo launchd runner (every 4 hours).
#
# WHY launchd, not GitHub Actions: the staging Hub is a Tailscale IP on the prod
# host (100.68.120.99:4101). GitHub-hosted runners can't reach it, and a
# self-hosted runner is unsafe on this PUBLIC repo. Bravo is already on the
# tailnet with Doppler `factorylm/stg` + Playwright, so it's the right host.
# Same rationale + token/env pattern as tools/qa/rbac/weekly_inspect.sh.
#
# Routine: reseed (idempotent — also applies the tenants-mirror so beta-gate can
# upload) -> mint the persona sessions (they expire, so re-mint every run) ->
# run the dogfood judge across all product paths -> report to
# qa/dogfood/latest-report.md + a timestamped run dir.
#
# Filing is OFF by default (report-only) — auto-opening GitHub issues unattended
# is outward-facing. Set DOGFOOD_FILE_ISSUES=1 to enable the judge's gated,
# two-persona-verified, deduped filing (needs GITHUB_PAT in Doppler stg).
#
# Manual run:  bash tools/crew/dogfood/scheduled_run.sh
# Scheduled :  ~/Library/LaunchAgents/com.factorylm.dogfood-judge.plist  (4h)
set -uo pipefail

REPO="/Users/bravonode/Mira"
# launchd starts with a minimal PATH — pin the toolchain explicitly.
export PATH="/Users/bravonode/.local/bin:/Users/bravonode/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export QA_BASE_URL="${QA_BASE_URL:-http://100.68.120.99:4101}"

# Read-only stg service token (launchd's non-login env can't read the keychain
# CLI token). Shared with the RBAC weekly job; stg-scoped, stored 0600, uncommitted.
DOPPLER_TOKEN_FILE="${DOPPLER_TOKEN_FILE:-$HOME/.doppler/rbac-weekly-stg.token}"
if [ -z "${DOPPLER_TOKEN:-}" ] && [ -r "$DOPPLER_TOKEN_FILE" ]; then
  DOPPLER_TOKEN="$(cat "$DOPPLER_TOKEN_FILE")"; export DOPPLER_TOKEN
fi

cd "$REPO" || { echo "[dogfood] repo not found: $REPO"; exit 1; }

TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$REPO/dogfood-output/qa-runs/dogfood-scheduled-$TS"
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1

echo "[dogfood] start $TS  HEAD=$(git rev-parse --short HEAD 2>/dev/null)  base=$QA_BASE_URL"

DRUN=(doppler run --project factorylm --config stg --)

# 1) Reseed — idempotent (ON CONFLICT). Ensures personas exist AND that the
#    data-side tenants mirror is present (so the beta-gate upload path works).
#    Non-fatal: if fixtures already exist, a warn must not abort the run.
if "${DRUN[@]}" bun run mira-hub/scripts/seed-synthetic-users.ts > "$OUT/seed.log" 2>&1; then
  echo "[dogfood] seed ok"
else
  echo "[dogfood] seed WARN (see seed.log) — continuing; the judge self-classifies auth as INFRA"
fi

# 2) Mint fresh persona sessions into dogfood-output/.auth/<localpart>-state.json
#    (NextAuth sessions expire; a 4h cadence must re-mint or every run is INFRA).
"${DRUN[@]}" bash -c '
  set -e
  for pair in \
    "carlos@synthetic.test:SYNTHETIC_CARLOS_PASSWORD" \
    "dana@synthetic.test:SYNTHETIC_DANA_PASSWORD" \
    "operator@synthetic.test:SYNTHETIC_OPERATOR_PASSWORD" \
    "plantmgr@synthetic.test:SYNTHETIC_PLANTMGR_PASSWORD" \
    "cfo@synthetic.test:SYNTHETIC_CFO_PASSWORD" \
    "scheduler@synthetic.test:SYNTHETIC_SCHEDULER_PASSWORD" \
    "isolation@synthetic.test:SYNTHETIC_ISOLATION_PASSWORD"; do
    email="${pair%%:*}"; envvar="${pair##*:}"; password="${!envvar}"
    [ -z "$password" ] && { echo "  WARN $envvar unset — skip $email"; continue; }
    node dogfood-output/qa-login-save-state.mjs "$email" "$password" >/dev/null 2>&1 \
      && echo "  minted $email" || echo "  MINT FAIL $email"
  done
' 2>&1 | tee "$OUT/mint.log"

# 3) Run the judge across all product paths. Report-only unless DOGFOOD_FILE_ISSUES=1.
JUDGE_ARGS=()
if [ "${DOGFOOD_FILE_ISSUES:-0}" = "1" ]; then
  echo "[dogfood] filing ENABLED — confirmed, deduped REDs will be opened as issues"
  GH_TOKEN="$(doppler secrets get GITHUB_PAT --project factorylm --config stg --plain 2>/dev/null)"; export GH_TOKEN
  JUDGE_ARGS+=(--file-issues)
else
  echo "[dogfood] report-only (set DOGFOOD_FILE_ISSUES=1 to enable gated filing)"
fi

OUT_DIR="$OUT" bash tools/crew/dogfood/judge.sh ${JUDGE_ARGS[@]+"${JUDGE_ARGS[@]}"}
rc=$?

echo "[dogfood] done rc=$rc — report: qa/dogfood/latest-report.md  evidence: $OUT"
# Append a one-line trend entry so a human can skim the history without opening reports.
verdict="$(grep -m1 -oE 'Overall: (GREEN|YELLOW|RED)' qa/dogfood/latest-report.md 2>/dev/null || echo 'Overall: ?')"
printf '%s  %s  (run %s)\n' "$TS" "$verdict" "$(basename "$OUT")" >> "$REPO/qa/dogfood/history.log"
exit "$rc"
