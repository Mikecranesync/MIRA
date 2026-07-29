#!/usr/bin/env bash
# Weekly RBAC inspect — Bravo launchd runner (the CANONICAL weekly venue).
#
# WHY launchd, not GitHub Actions: the staging Hub is a Tailscale IP on the prod
# host (100.68.120.99:4101). GitHub-hosted runners cannot reach it, and a
# self-hosted runner is unsafe on this PUBLIC repo (a fork PR could RCE onto a
# tailnet node with prod/Doppler/SSH reach). Bravo is already on the tailnet with
# Doppler `factorylm/stg` + Playwright, so it is the right place to run this.
# `.github/workflows/qa-rbac-inspect.yml` stays skip-clean as the GH-side
# placeholder until a public `stg.factorylm.com` exists. See
# `tools/qa/rbac/README.md` and the `project_rbac_qa_staging` memory.
#
# Routine (mirrors the GH workflow): reseed (idempotent) -> mint 7 persona
# sessions -> Layer-A isolation probe + Layer-C deny-grid -> comment results on
# #578. Self-validating: if the isolation control fails or deny-grid setup errors,
# the probes exit non-zero and that is reported (not a silent green).
#
# Manual run:  bash tools/qa/rbac/weekly_inspect.sh
# Scheduled :  ~/Library/LaunchAgents/com.factorylm.rbac-weekly-inspect.plist
set -uo pipefail

REPO="/Users/bravonode/Mira"
# launchd starts with a minimal PATH — pin the toolchain explicitly.
export PATH="/Users/bravonode/.local/bin:/Users/bravonode/.bun/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export QA_BASE_URL="${QA_BASE_URL:-http://100.68.120.99:4101}"

# Doppler token: launchd's non-login env can't read Bravo's keychain-stored CLI
# token (env -i fails even with HOME set). Use a read-only `factorylm/stg` service
# token created once and stored 0600 outside the repo (never committed). All
# doppler calls below pass `--config stg` explicitly because this token is
# stg-scoped and the repo dir's local doppler scope is `prd`.
DOPPLER_TOKEN_FILE="${DOPPLER_TOKEN_FILE:-$HOME/.doppler/rbac-weekly-stg.token}"
if [ -z "${DOPPLER_TOKEN:-}" ] && [ -r "$DOPPLER_TOKEN_FILE" ]; then
  DOPPLER_TOKEN="$(cat "$DOPPLER_TOKEN_FILE")"; export DOPPLER_TOKEN
fi

cd "$REPO" || { echo "[weekly-rbac] repo not found: $REPO"; exit 1; }

TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$REPO/dogfood-output/qa-runs/rbac-weekly-$TS"
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1

echo "[weekly-rbac] start $TS  HEAD=$(git rev-parse --short HEAD 2>/dev/null)  base=$QA_BASE_URL"

DRUN=(doppler run --project factorylm --config stg --)

# 1) Reseed — idempotent (ON CONFLICT). Guards against a staging Neon reset/branch.
#    Non-fatal: if the Hub fixtures already exist, a warn here must not abort the run.
if "${DRUN[@]}" bun run mira-hub/scripts/seed-synthetic-users.ts > "$OUT/seed.log" 2>&1; then
  echo "[weekly-rbac] seed ok"
else
  echo "[weekly-rbac] seed WARN (see seed.log) — continuing; probes self-validate"
fi

# 2) Mint the 7 persona sessions into dogfood-output/.auth/<localpart>-state.json
"${DRUN[@]}" bash -c '
  set -e
  for pair in \
    "carlos@synthetic.test:SYNTHETIC_CARLOS_PASSWORD" \
    "dana@synthetic.test:SYNTHETIC_DANA_PASSWORD" \
    "scheduler@synthetic.test:SYNTHETIC_SCHEDULER_PASSWORD" \
    "operator@synthetic.test:SYNTHETIC_OPERATOR_PASSWORD" \
    "plantmgr@synthetic.test:SYNTHETIC_PLANTMGR_PASSWORD" \
    "cfo@synthetic.test:SYNTHETIC_CFO_PASSWORD" \
    "isolation@synthetic.test:SYNTHETIC_ISOLATION_PASSWORD"; do
    email="${pair%%:*}"; envvar="${pair##*:}"; password="${!envvar}"
    [ -z "$password" ] && { echo "::warn:: $envvar unset — skip $email"; continue; }
    node dogfood-output/qa-login-save-state.mjs "$email" "$password" >/dev/null 2>&1 \
      && echo "  minted $email" || echo "  MINT FAIL $email"
  done
' 2>&1 | tee "$OUT/mint.log"

# 3) Probes — capture markdown + exit codes
node tools/qa/rbac/isolation_probe.mjs > "$OUT/isolation.md" 2>&1; ISO=$?
node tools/qa/rbac/run_deny_grid.mjs   > "$OUT/deny-grid.md" 2>&1; GRID=$?
echo "[weekly-rbac] isolation exit=$ISO  deny-grid exit=$GRID"

# 4) Comment on #578 (GH_TOKEN from Doppler — launchd can't read the gh keyring)
GH_TOKEN="$(doppler secrets get GITHUB_PAT --project factorylm --config stg --plain 2>/dev/null)"
export GH_TOKEN
ISOLATION_OUT="$(cat "$OUT/isolation.md" 2>/dev/null || echo '(no output)')"
GRID_OUT="$(cat "$OUT/deny-grid.md" 2>/dev/null || echo '(no output)')"
BODY="## RBAC deny-grid run (Bravo launchd) — $TS

**Base URL:** \`$QA_BASE_URL\`
**Isolation exit:** \`$ISO\`  **Deny-grid exit:** \`$GRID\`

<details><summary>Layer A — Tenant isolation probe</summary>

\`\`\`
$ISOLATION_OUT
\`\`\`
</details>

<details><summary>Layer C — Per-role deny-grid</summary>

\`\`\`
$GRID_OUT
\`\`\`
</details>

_Filed by \`tools/qa/rbac/weekly_inspect.sh\` on Bravo. Forward-looking fail-opens (\`currentlyEnforced: false\`) are expected until per-role wiring lands (#578)._"

if [ -n "${RBAC_SKIP_COMMENT:-}" ]; then
  echo "[weekly-rbac] RBAC_SKIP_COMMENT set — wrote body to $OUT/body.md, not posting"
  printf '%s\n' "$BODY" > "$OUT/body.md"
elif [ -n "$GH_TOKEN" ]; then
  gh issue comment 578 --repo Mikecranesync/MIRA --body "$BODY" \
    && echo "[weekly-rbac] commented on #578" || echo "[weekly-rbac] #578 comment FAILED"
else
  echo "[weekly-rbac] no GITHUB_PAT — skipping #578 comment"
fi

echo "[weekly-rbac] done. artifacts -> $OUT"
# Exit non-zero only on a genuinely untrustworthy run (control/setup broken = exit 2).
[ "$ISO" = "2" ] || [ "$GRID" = "2" ] && exit 2
exit 0
