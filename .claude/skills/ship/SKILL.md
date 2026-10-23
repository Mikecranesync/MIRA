---
name: ship
description: Use when taking a merged-or-ready fix live end-to-end and PROVING it — merge on an exact-head GREEN, deploy the exact SHA to staging, retest the behaviour with a real question, let acceptance authorize, deploy that same SHA to production, confirm build identity, retest on prod. Triggers on "ship it", "deploy this", "take it live", "merge and deploy", "deploy and retest", "prove it on prod". For visible mira-web changes delegate to design-ship-routine; for mira-ask/kiosk follow the kiosk runbook.
---

# ship — merge → staging → retest → prod → retest

Proven path (2026-10-23, #4652 restart-safety banner: merge to prod-proven in ~45 min).
"Deployed" is not "done". **Done = the new behaviour observed on production for the exact SHA.**

## Route first

- Visible mira-web change → `design-ship-routine`.
- mira-ask / kiosk / `ask_api` → `docs/runbooks/kiosk-askmira-deploy-and-verify.md` (`services=mira-ask`).
- Hub chat / retrieval / safety-wording fix → this skill, end to end.

## 1. Merge (owner says "merge")

```bash
bash tools/pr-merge-blocker.sh <n>          # must print CLEAN — never trust a bare BEHIND/BLOCKED
gh pr view <n> --json headRefOid -q .headRefOid   # must equal the Codex GREEN reviewed_sha
gh pr merge <n> --squash --match-head-commit <that sha>
```
- main protection has `strict=false` since 2026-10-23 (owner, A2). A GREEN, all-required-pass PR merges
  as-is, so **don't update the branch**: that moves the head and voids the exact-head GREEN.
- R0 (eval data / docs) needs no Codex. R1+ needs GREEN, or CONVERGED + `[REVIEW-FOLLOWUPS]`, at the exact head.
- Several merges in a row cancel each other's main `CI`. Read the **last** main SHA's checks.

## 2. Staging deploy of the exact SHA

```bash
SHA=$(git rev-parse origin/main)            # 40-hex, the commit you mean to ship
gh workflow run deploy-staging.yml -f approved_rc_sha=$SHA -f services=mira-hub
curl -sL https://app-staging.factorylm.com/api/version/   # gitSha must == $SHA before any retest
```
The staging deploy auto-triggers `retrieval-acceptance.yml`, which writes `acceptance-receipt-<SHA>`.
Production refuses without it.

## 3. Behavioural retest on staging (the proof, not "deploy succeeded")

`tools/qa/notebook_ask_probe.py` asks real questions through the same APIs the apps use, and
asserts on the answer text.

- **Self-contained mode** (`--manual-page`): creates a throwaway notebook, uploads a tiny manual,
  waits until it is chat-ready, asks, then deletes everything it made.
- **Fresh staging login, no stored password:**

```bash
( cd mira-hub && doppler run -p factorylm -c stg -- bun run scripts/provision-beta-gate.ts ) > $SCRATCH/env.out
export BETA_PROBE_COOKIE="$(grep '^ENV:BETA_PROBE_COOKIE=' $SCRATCH/env.out | cut -d= -f2-)"
python3 tools/qa/notebook_ask_probe.py --base https://app-staging.factorylm.com \
  --manual-page "<page text that answers the question>" \
  --ask "<question that must show the fix>" --control "<similar question that must NOT>" \
  --expect "<exact text the fix produces>" --out $SCRATCH/retest-staging.json
# cleanup the stranger afterwards:
( cd mira-hub && doppler run -p factorylm -c stg -- bun run scripts/provision-beta-gate.ts --cleanup <BETA_GATE_TENANT> )
```

Rules (`.claude/rules/prove-the-test-fails.md`):
- **Every run needs at least one `--control`.** Without one, an always-on change also "passes".
- **Prove the probe can go red once.** Put a control question under `--ask`; it must FAIL, with exit 1.
- **Before/after:** run the probe against staging **before** you dispatch the deploy, or against prod
  while it is still on the old build. That gives a real "before". Missed it? Say so, and cite the
  issue's original repro.
- An `--ask` that is refused fails by design: the fix was not exercised.

## 4. Production deploy of the SAME SHA (owner says "deploy")

Wait until the auto `retrieval-acceptance` run for this deploy **completes** with
`overall=PASS authorizes=True identity_end=<SHA>`. A prod dispatch before then is refused.

```bash
gh workflow run deploy-vps.yml -f approved_rc_sha=$SHA -f approved_release_tag=vX.Y.Z -f services=mira-hub
curl -sL https://app.factorylm.com/api/version/      # gitSha == $SHA, version == tag
```
- Prod runs only `mira-hub`, `mira-web`, `mira-ask-saas` (+ `mira-ollama`). Name the service.
- If main moved during the run (another session merged), still ship the SHA staging proved. Never
  substitute the newer head.

## 5. Behavioural retest on production

The same probe and arguments, `--base https://app.factorylm.com`, using the prod QA tenant
(Doppler `factorylm/prd` `BETA_PROBE_QA_EMAIL` / `BETA_PROBE_QA_PASSWORD`).
- The prod-guard hook blocks an agent from reading prd secrets. That is correct, so don't route
  around it.
- Hand the owner one short command, a gitignored wrapper under `.planning/`:
  `! MIRA_ALLOW_PROD=1 bash .planning/prod-retest.sh`
- Or dispatch a CI workflow that reads them, the `beta-probe-prod.yml` pattern.
- Until the prod probe runs, report prod as "same build as the staging-proven SHA (identity
  checked)". Do not call it "behaviour proven on prod".

## Report (plain terms)

PR → merge SHA → staging SHA plus probe result (N/N, controls) → acceptance receipt → prod SHA plus
version → prod probe result. Name every gap honestly (no before-baseline, prod probe pending, …).

## Don'ts

- ❌ Calling it "shipped" on merge or on a green deploy job.
- ❌ Retesting before `/api/version/` shows the new SHA. A 502 mid-restart is not a result.
- ❌ A probe with no control, or one never seen to fail.
- ❌ Updating a GREEN PR's branch "to be safe". That voids its review.
- ❌ `docker compose` on the VPS, or reading prd secrets from an agent shell.
