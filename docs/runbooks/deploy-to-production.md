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

### Step 3 — Deploy is a manual dispatch (nothing fires on Smoke)

`.github/workflows/deploy-vps.yml` is `workflow_dispatch` **only** ("AUTO-DEPLOY stays DISABLED"). The `workflow_run: ["Smoke Test"]` trigger described in earlier revisions of this runbook no longer exists. To deploy:
```bash
gh workflow run deploy-vps.yml -f approved_rc_sha=<40-hex commit on main> [-f services="mira-hub mira-web mira-ask"]
```
`authorize-source` then requires, for that SHA: a green Staging Gate on the PR head mapped from the merge commit (squash-merge aware), an unexpired (≤168 h) verified `staging-receipt-<sha>` from `deploy-staging.yml`, and zero migration filename drift. Push-time smoke is a signal, not a gate.
(Source: `.github/workflows/deploy-vps.yml`; rules in `docs/architecture/mira-sdlc-v1.md` §7)

### Step 4 — Watch the deploy

```bash
# List the most recent deploy runs
gh run list --workflow=deploy-vps.yml --limit 5

# Watch a specific run live (use the run ID from the list above)
gh run watch <RUN_ID>

# Or tail the log of a running deploy
gh run view <RUN_ID> --log
```

The deploy job runs on the VPS via SSH. Default targets when `services` is empty
(`.github/workflows/deploy-vps.yml`, `TARGETS="${SERVICES:-mira-hub mira-web mira-ask}"`):
```
mira-hub mira-web mira-ask
```
(the #3800 OVH minimal set; `mira-ask` restored 2026-09-27). Not every container is rebuilt on every
deploy — only the ones listed, and the receipt proves the runtime identity only for the selected Hub/Web.

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

## Hotfix path (no bypass inputs exist)

Use this only when production is degraded and the normal flow is too slow. **`deploy-vps.yml` has no `skip_staging_gate` / `skip_reason` inputs any more — it rejects every `skip_*` input at `authorize-source`.** A hotfix is the normal path with the queue cleared and the emergency recorded (`docs/architecture/mira-sdlc-v1.md` §10.1):

1. Open an `incident` issue (fixed fields: `docs/agents/issue-tracker.md`).
2. Fix PR titled `fix(hotfix): …`, `Risk: R3 — production-control`; cheap lane one round; required contexts green.
3. `deploy-staging.yml` for the merge SHA, acceptance for the capabilities in scope, then
   `gh workflow run deploy-vps.yml -f approved_rc_sha=<sha> -f services="<narrowest list containing the fix>"`.
4. Regression disposition on the incident within 24 hours.

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
| **Batched merges: last commit(s) silently NOT deployed** | Merging several PRs in quick succession makes each push's Smoke Test supersede the previous; only the last *successful* Smoke commit deploys, and later commits' deploy jobs show **skipped**. The top deploy can be an *intermediate* commit that lacks your latest fix. | After any merge batch, `gh run list --workflow=deploy-vps.yml --limit 5` — the newest run's `headSha` MUST equal `git rev-parse origin/main`. If not, dispatch the hotfix path (above) to land main HEAD. (Secret-shopper batch 2026-06-21: P0 #2190 merged but sat undeployed.) |
| Non-engine PR (hub/web only) won't deploy via the normal path | **Staging Gate is path-filtered** to the Python engine paths (`mira-bots/`, `tests/eval/`); it never runs on a `mira-hub`/`mira-web`-only PR, so deploy-vps's "Verify Staging Gate passed" step finds nothing and aborts. It also wouldn't *exercise* Hub TS retrieval (`manual-rag.ts`) anyway. | Verify the change appropriately (for Hub TS retrieval: a direct staging-corpus BM25 simulation — see `.claude/skills/retrieval-diagnostics/SKILL.md`), then deploy via the hotfix dispatch with `skip_staging_gate=true` and a `skip_reason` stating *why the gate is inapplicable + how you verified*. |
