# RBAC synthetic-worker QA (#578)

Drives the 7 seeded RBAC personas (`mira-hub/scripts/seed-synthetic-users.ts`)
against the staging Hub to test two boundaries:

- **Layer A — tenant isolation / RLS** (`isolation_probe.mjs`) — enforced today.
  A second-tenant persona must never read tenant-1 objects; a same-tenant control
  must read them (else the run is "untrustworthy", exit 2).
- **Layer C — per-role deny-grid** (`run_deny_grid.mjs` + `deny-grid.json`) —
  4 self-validating controls + forward-looking per-role fail-opens that are
  expected until role wiring lands (#578: `role:"member"` is hardcoded).

`classify()` (in `lib.mjs`) maps each probe's HTTP status to a verdict; the
runners exit non-zero only when a *control* breaks (setup/session bad), not when
a forward-looking fail-open is recorded.

## The live weekly run is on Bravo (NOT GitHub Actions)

`weekly_inspect.sh` + the launchd agent `com.factorylm.rbac-weekly-inspect` is the
canonical weekly venue. **Why not GitHub Actions?** The staging Hub is a Tailscale
IP on the prod host (`100.68.120.99:4101`). GH-hosted runners aren't on the
tailnet (can't reach it); a self-hosted runner is unsafe because this repo is
**public** (fork-PR RCE onto a tailnet node); and reusing the prod-shared
`TS_AUTH_KEY` in CI was rejected. Bravo is already on the tailnet with Doppler
`stg` + Playwright, so it runs there. `.github/workflows/qa-rbac-inspect.yml`
stays skip-clean as the GH-side placeholder until a public `stg.factorylm.com`
exists.

### Install on Bravo (one-time)

```bash
# 1. Read-only stg Doppler service token (launchd can't read the keychain CLI token):
doppler configs tokens create "rbac-weekly-bravo" --project factorylm --config stg --plain --max-age 0 \
  > ~/.doppler/rbac-weekly-stg.token && chmod 600 ~/.doppler/rbac-weekly-stg.token

# 2. Install + load the launchd agent:
cp tools/qa/rbac/com.factorylm.rbac-weekly-inspect.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.factorylm.rbac-weekly-inspect.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.factorylm.rbac-weekly-inspect.plist
```

Runs every **Monday 06:00 local**. Test now: `launchctl start com.factorylm.rbac-weekly-inspect`
(posts a real comment to #578). Dry test without posting:
`RBAC_SKIP_COMMENT=1 bash tools/qa/rbac/weekly_inspect.sh`.

### What the runner does

reseed (idempotent) → mint 7 sessions → isolation probe + deny-grid → comment
results on #578. Artifacts land in `dogfood-output/qa-runs/rbac-weekly-<ts>/`;
launchd stdout/err in `dogfood-output/qa-runs/rbac-weekly.launchd.{out,err}.log`.

## Manual run (any machine on the tailnet)

```bash
export QA_BASE_URL=http://100.68.120.99:4101
doppler run -p factorylm -c stg -- node dogfood-output/qa-login-save-state.mjs <email> "$SYNTHETIC_<X>_PASSWORD"
node tools/qa/rbac/isolation_probe.mjs
node tools/qa/rbac/run_deny_grid.mjs        # add --strict to gate once #578 lands
```

See also: `project_rbac_qa_staging` memory; `mira-hub/scripts/seed-synthetic-users.ts`.
