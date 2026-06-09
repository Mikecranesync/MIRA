# Deploy to Production

**Authoritative doctrine:** `docs/environments.md` — read that first for the full env-separation rules.
**Incident post-mortem:** `docs/incidents/2026-06-02-prod-pipeline-deploy.md` — explains the two root causes behind the last crash-loop.

This runbook covers the full flow from a merged PR to a verified-healthy VPS.

---

## Prerequisites

- `gh` CLI authenticated as a repo member (`gh auth status`)
- SSH access: `ssh factorylm-prod` (alias for `root@165.245.138.91`)
  — see `docs/runbooks/factorylm-vps.md:7-10` for key details
- `prod-guard.sh` is a `PreToolUse(Bash)` hook that **blocks** SSH and docker commands targeting prod.
  Override for a single shell: `export MIRA_ALLOW_PROD=1` (human only; never script this)
  — hook pattern: `tools/hooks/prod-guard.sh`

---

## Normal automatic path (merge → VPS in ~8-12 minutes)

### Step 1 — Merge a PR to `main`

```bash
gh pr merge <PR_NUMBER> --squash   # or --merge / --rebase
```

Only one required check must pass before merge: `staging-gate` (the job name is
`staging-gate` inside the workflow `Staging Gate` — the ruleset check context is
literally `"staging-gate"`, verified in GitHub Ruleset #17097034).

Auto-merge is **disabled** on this repo (`allow_auto_merge: false`, confirmed via
`gh api repos/Mikecranesync/MIRA --jq .allow_auto_merge`). You must merge manually.

### Step 2 — Smoke Test fires on push to `main`

`.github/workflows/smoke-test.yml` triggers on `push: branches: [main]`.
It pings `factorylm.com` and `app.factorylm.com` via Playwright.

Path-filtered: pushes that touch only `docs/**`, `wiki/**`, `**/*.md`, or `.claude/**`
**skip** the smoke run — `deploy-vps.yml` never fires for those pushes.
(Source: `.github/workflows/smoke-test.yml:24-35`)

### Step 3 — Deploy fires when Smoke passes

`.github/workflows/deploy-vps.yml` listens for:
```yaml
workflow_run:
  workflows: ["Smoke Test"]
  types: [completed]
```
and runs only when `conclusion == 'success'`.

It also verifies that the `staging-gate` workflow ran and succeeded on the PR head SHA
before deploying. If the merge commit was produced by squash-merge, the workflow
matches by the PR branch's head SHA.
(Source: `docs/environments.md:38`, `.github/workflows/deploy-vps.yml`)

### Step 4 — Watch the deploy

```bash
# List the most recent deploy runs
gh run list --workflow=deploy-vps.yml --limit 5

# Watch a specific run live (use the run ID from the list above)
gh run watch <RUN_ID>

# Or tail the log of a running deploy
gh run view <RUN_ID> --log
```

The deploy job runs on the VPS via SSH. Default targets
(`.github/workflows/deploy-vps.yml:199`):
```
mira-pipeline mira-ingest mira-mcp mira-hub mira-cmms-sync mira-bot-telegram mira-bot-slack
```
Not every container is rebuilt on every deploy — only the ones listed above.

### Step 5 — Post-deploy verification

**Never use `install/smoke_test.sh` for prod verification.** That script tests
DEV/edge ports (3000, 8002, 1880, etc.) that do not exist on the VPS.

Use these prod health checks instead:

```bash
# External (from your laptop, no SSH needed)
curl -sS https://factorylm.com/api/health
curl -sS https://app.factorylm.com/api/health

# Internal pipeline health (on the VPS — requires MIRA_ALLOW_PROD=1)
MIRA_ALLOW_PROD=1 ssh factorylm-prod "curl -sf http://localhost:9099/health"
MIRA_ALLOW_PROD=1 ssh factorylm-prod "curl -sf http://127.0.0.1:3101/api/health"
```

Expected output from the pipeline: `ok` (the string literal)
Expected output from Hub: `{"status":"ok"}` or `200`
Expected output from external: HTTP 200 body

For a full container health sweep, follow `docs/runbooks/vps-health-check.md`.

---

## False-failure gotcha (deploy-vps.yml health probe)

After starting containers, the workflow runs:
```bash
sleep 8 && curl -sf http://localhost:9099/health
```
(`.github/workflows/deploy-vps.yml:219-226`)

If `mira-pipeline-saas` hasn't fully initialized within 8 seconds (cold image pull,
heavy startup), this probe exits 1 and the step shows as **failed** in Actions —
even though the container came up healthy seconds later. The workflow does not fail
the entire job on this probe alone, but the step shows red.

**What to do:** wait 30 seconds and re-run the external health check:
```bash
curl -sS https://app.factorylm.com/api/health
```
If it returns 200, the deploy succeeded. The red step is a false alarm.

---

## Hotfix workflow_dispatch path

Use this only when production is degraded and the normal merge-gate flow is too slow.

```bash
gh workflow run deploy-vps.yml \
  -f services="mira-pipeline mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="Chat crash-loop: missing COPY in Dockerfile, fix in #1667"
```

**`skip_reason` is required.** An empty string causes `exit 1` before docker runs
(`.github/workflows/deploy-vps.yml:76-79`). The workflow attempts to open a GitHub
audit issue; if that fails (token lacks `issues:write`), it warns and continues —
non-fatal since PR #1673.

After a hotfix dispatch:
1. Verify prod health (Step 5 above).
2. File a follow-up PR with the real fix within 24 hours. The hotfix bypassed the
   staging gate — that bypass must be corrected through the normal gate.

---

## Concurrency

Only one deploy runs at a time. The job uses:
```yaml
concurrency:
  group: deploy-vps
  cancel-in-progress: false
```
A second dispatch while a deploy is running queues (does not cancel the running one).

---

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Smoke test skipped, deploy never fires | Push touched only docs/wiki/markdown — path filter applies | Trigger smoke manually: `gh workflow run smoke-test.yml` then dispatch deploy |
| `ModuleNotFoundError` crash-loop on startup | New `.py` file added to `mira-pipeline/` but not covered by `COPY` in Dockerfile | See incident `docs/incidents/2026-06-02-prod-pipeline-deploy.md`; current fix is `COPY mira-pipeline/*.py .` |
| Deploy step shows red but prod is healthy | False-failure on 8s health probe | Check external URL; red step is cosmetic if prod answers 200 |
| `gh workflow run` exits 1 immediately | `skip_reason` is empty | Provide a non-empty `skip_reason` string |
| Container removed (not just stopped), self-healer can't recover | `docker restart` cannot recreate a removed container | Dispatch hotfix: `gh workflow run deploy-vps.yml -f services=mira-hub -f skip_staging_gate=true -f skip_reason="container removed, not crashed"` — see `docs/research/2026-06-06-workflow-durability-audit.md` for details |
| Staging Gate check never ran on the merge commit | Squash-merge SHA doesn't match what staging-gate ran | Check Actions → Staging Gate → filter by PR branch; if absent, run `gh workflow run staging-gate.yml` on the branch before merging |
| deploy-vps.yml refuses to run even after smoke passes | Staging gate conclusion wasn't `success` on PR head SHA | See `docs/environments.md:38` — deploy verifies staging gate before deploying |
